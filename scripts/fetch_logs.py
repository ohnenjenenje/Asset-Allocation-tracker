#!/usr/bin/env python3
"""
Fetch production logs for AI debugging — per-project, per-account.

Supports:
  1. BetterStack Telemetry API v2 — preferred, no SQL setup required
  2. BetterStack SQL API (ClickHouse) — works with an existing SQL connection
  3. Render.com API via RENDER_API_KEY + RENDER_SERVICE_ID — deploy/build logs

Config: .env.logs in project root (gitignored) — copy per project folder with its own account.
  BETTERSTACK_API_TOKEN=<your-team-token>
  BETTERSTACK_SOURCE_ID=2733159
  BETTERSTACK_SQL_HOST=eu-nbg-2-connect.betterstackdata.com
  BETTERSTACK_SQL_USER=...
  BETTERSTACK_SQL_PASSWORD=...
  BETTERSTACK_SOURCE_TABLE=t123456_your_source_logs
  RENDER_API_KEY=rnd_xxx
  RENDER_SERVICE_ID=srv-xxx

Usage:
  python scripts/fetch_logs.py                # auto: BetterStack if configured, else Render, else help
  python scripts/fetch_logs.py --errors       # filter + deduplicate tracebacks
  python scripts/fetch_logs.py --tail 100     # last 100 rows
  python scripts/fetch_logs.py --since now-7d # widen the time range
  python scripts/fetch_logs.py --source render --tail 50
  python scripts/fetch_logs.py --source betterstack --query "ERROR" --tail 200
  python scripts/fetch_logs.py --list-sources # list BetterStack sources via Telemetry API

For other projects: copy .env.logs to that folder with that project's tokens.
"""
from __future__ import annotations
import argparse
import os
import sys
import json
import re
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = PROJECT_ROOT / ".env.logs"

def load_dotenv(path: Path):
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line=line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k,v=line.split("=",1)
        k=k.strip(); v=v.strip().strip('"').strip("'")
        if k and v and k not in os.environ:
            os.environ[k]=v

load_dotenv(ENV_PATH)
# also load .env if present for RENDER_EXTERNAL_URL etc.
for p in [PROJECT_ROOT / ".env", PROJECT_ROOT / ".env.local"]:
    load_dotenv(p)

# ---------- BetterStack ----------
def betterstack_list_sources(token: str):
    url="https://telemetry.betterstack.com/api/v1/sources"
    req=urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body=e.read().decode()[:2000]
        print(f"[BetterStack] list sources failed: {e.code} {e.reason}\n{body}", file=sys.stderr)
        return None

def betterstack_query_sql(host: str, user: str, pwd: str, table: str, query_filter: str = "", limit: int=100):
    # Build ClickHouse SQL over remote() + s3 for completeness (per docs)
    base_table = table.replace("_logs","").replace("_s3","")
    # Normalize: user passes t123_logs -> we want t123
    # BetterStack docs: remote(t123_logs) + s3Cluster(primary, t123_s3) WHERE _row_type=1
    if table.endswith("_logs"):
        remote_logs = f"remote({table})"
        s3_table = table.replace("_logs","_s3")
    elif table.endswith("_s3"):
        s3_table = table
        remote_logs = f"remote({table.replace('_s3','_logs')})"
    else:
        remote_logs = f"remote({table}_logs)"
        s3_table = f"{table}_s3"

    where_clause = ""
    if query_filter:
        # escape single quotes for SQL
        q = query_filter.replace("'", "\\'")
        where_clause = f"WHERE raw LIKE '%{q}%'"

    sql = f"""SELECT dt, raw FROM (
  SELECT dt, raw FROM {remote_logs}
  UNION ALL
  SELECT dt, raw FROM s3Cluster(primary, {s3_table}) WHERE _row_type = 1
) {where_clause} ORDER BY dt DESC LIMIT {limit} FORMAT JSONEachRow"""

    def run(query: str):
        url = f"https://{host}?output_format_pretty_row_numbers=0"
        import base64
        cred = base64.b64encode(f"{user}:{pwd}".encode()).decode()
        req = urllib.request.Request(url, data=query.encode(), headers={"Authorization": f"Basic {cred}", "Content-Type":"text/plain"}, method="POST")
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            rows=[]
            for line in text.strip().splitlines():
                if not line.strip(): continue
                try: rows.append(json.loads(line))
                except: rows.append({"raw": line})
            return rows

    try:
        return run(sql)
    except urllib.error.HTTPError as e:
        body=e.read().decode()[:3000]
        # A source created after the SQL connection was set up may only be
        # reachable through the S3 (cold storage) table. Retry without the
        # live remote() table before giving up.
        if "CLUSTER_DOESNT_EXIST" in body or "NAMED_COLLECTION_DOESNT_EXIST" in body:
            s3_sql = f"""SELECT dt, raw FROM s3Cluster(primary, {s3_table})
{where_clause} ORDER BY dt DESC LIMIT {limit} FORMAT JSONEachRow"""
            try:
                rows = run(s3_sql)
            except urllib.error.HTTPError as e2:
                body2=e2.read().decode()[:2000]
                print(f"[BetterStack SQL] live and S3 queries failed: {e2.code} {e2.reason}\n{body2}", file=sys.stderr)
                return None
            if not rows:
                print(
                    "[BetterStack SQL] live cluster is not available and S3 returned 0 rows.\n"
                    "  The source exists, but it is not attached to this SQL connection.\n"
                    "  Recreate the SQL API connection in BetterStack (Team settings -> SQL API),\n"
                    "  then update BETTERSTACK_SQL_HOST/USER/PASSWORD in .env.logs.\n"
                    f"  SQL: {s3_sql}",
                    file=sys.stderr,
                )
                return None
            return rows
        print(f"[BetterStack SQL] query failed: {e.code} {e.reason}\n{body}\nSQL:\n{sql}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[BetterStack SQL] error: {e}", file=sys.stderr)
        return None

def betterstack_query_v2(token: str, source_id: str, query_filter: str = "", limit: int = 100, start_time: str = "now-24h"):
    """Query logs through Telemetry API v2 — no SQL connection required."""
    sql = "SELECT dt, raw FROM {{source}} WHERE dt >= {{start_time}} AND dt < {{end_time}}"
    if query_filter:
        q = query_filter.replace("'", "\\'")
        sql += f" AND raw LIKE '%{q}%'"
    sql += " ORDER BY dt DESC"

    payload = {
        "source_id": int(source_id),
        "source_type": "logs",
        "query": sql,
        "start_time": start_time,
        "limit": limit,
    }
    req = urllib.request.Request(
        "https://telemetry.betterstack.com/api/v2/query",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:2000]
        print(f"[BetterStack v2] query failed: {e.code} {e.reason}\n{body}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[BetterStack v2] error: {e}", file=sys.stderr)
        return None
    return data.get("data", {}).get("attributes", {}).get("rows", [])

def betterstack_fetch_via_telemetry_fallback(token: str, limit: int):
    # No SQL connection: guide the user to the v2 Query API or SQL credentials.
    print("[BetterStack] BETTERSTACK_API_TOKEN set but no source/SQL credentials.")
    print("  Add the source ID (preferred, no SQL setup needed):")
    print("     BETTERSTACK_SOURCE_ID=2733159")
    print("  Or create an SQL API connection:")
    print("  1. Go to https://telemetry.betterstack.com/team/0/dashboards/connections?tab=sql-api")
    print("  2. Click 'Connect ClickHouse HTTP client' -> select your team -> Create connection")
    print("  3. Copy Username / Password / Host (eu-nbg-2-...) and Source table (t123...)")
    print("  4. Add to .env.logs:")
    print("     BETTERSTACK_SQL_HOST=eu-nbg-2-connect.betterstackdata.com")
    print("     BETTERSTACK_SQL_USER=<username>")
    print("     BETTERSTACK_SQL_PASSWORD=<password>")
    print("     BETTERSTACK_SOURCE_TABLE=t123456_your_source_logs")
    print("\nAttempting to list sources via Telemetry API to help...")
    data=betterstack_list_sources(token)
    if data:
        print(json.dumps(data, indent=2)[:4000])
    return None

# ---------- Render ----------
def render_api_get(path: str, token: str):
    url=f"https://api.render.com/v1{path}"
    req=urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept":"application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body=e.read().decode()[:3000]
        print(f"[Render] GET {path} failed: {e.code} {e.reason}\n{body}", file=sys.stderr)
        return None

def render_fetch(service_id: str, token: str, tail: int=100):
    # Try logs endpoint first, fallback to deploys
    # Docs: Render Log Streams vs API; undocumented but try /logs and /deploys
    # Attempt 1: /services/{id}/logs (if exists)
    for p in [f"/services/{service_id}/logs?limit={tail}", f"/services/{service_id}/deploys?limit=5"]:
        data=render_api_get(p, token)
        if data is not None:
            print(f"[Render] {p} ->")
            print(json.dumps(data, indent=2)[:8000])
            if "logs" in p and data:
                return data
            if "deploys" in p and isinstance(data, list) and data:
                # fetch deploy logs for latest
                did=data[0].get("deploy",{}).get("id") or data[0].get("id")
                if did:
                    print(f"\n[Render] Fetching deploy logs for {did} ...")
                    d2=render_api_get(f"/services/{service_id}/deploys/{did}/logs?limit={tail}", token)
                    if d2:
                        print(json.dumps(d2, indent=2)[:8000])
                        return d2
            return data
    # Attempt service info
    info=render_api_get(f"/services/{service_id}", token)
    if info:
        print(json.dumps(info, indent=2)[:4000])
        return info
    return None

# ---------- Filtering ----------
ERROR_RE = re.compile(r"(ERROR|CRITICAL|Exception|Traceback|Task exception was never retrieved|NotImplementedError|Database objects do not implement|GOLDEN-SOURCE DRIFT|SEQ GAP|STALE MARK|FLAPPING)", re.I)
def filter_errors(rows, dedupe=True):
    out=[]
    seen=set()
    for r in rows:
        raw=r.get("raw","") if isinstance(r, dict) else str(r)
        if ERROR_RE.search(raw):
            if dedupe:
                key=raw.strip()[:500]
                if key in seen: continue
                seen.add(key)
            out.append(r)
    return out

def render_rows(rows, limit=None):
    for r in rows[:limit] if limit else rows:
        if isinstance(r, dict):
            dt=r.get("dt","")
            raw=r.get("raw","")
            # dt is ClickHouse DateTime64
            print(f"{dt} | {raw}")
        else:
            print(r)

def main():
    ap=argparse.ArgumentParser(description="Fetch Render/BetterStack logs per-project")
    ap.add_argument("--source", choices=["auto","betterstack","render"], default="auto", help="source to query")
    ap.add_argument("--tail", type=int, default=100, help="number of log lines")
    ap.add_argument("--query", type=str, default="", help="filter substring (BetterStack LIKE)")
    ap.add_argument("--errors", action="store_true", help="filter to ERROR/Traceback only")
    ap.add_argument("--since", type=str, default="now-24h", help="start time, e.g. now-1h or now-7d")
    ap.add_argument("--source-id", type=str, default="", help="BetterStack source ID override")
    ap.add_argument("--list-sources", action="store_true", help="list BetterStack sources")
    args=ap.parse_args()

    bt_token=os.environ.get("BETTERSTACK_API_TOKEN","").strip()
    bt_source_id=(args.source_id or os.environ.get("BETTERSTACK_SOURCE_ID","")).strip()
    bt_host=os.environ.get("BETTERSTACK_SQL_HOST","").strip()
    bt_user=os.environ.get("BETTERSTACK_SQL_USER","").strip()
    bt_pwd=os.environ.get("BETTERSTACK_SQL_PASSWORD","").strip()
    bt_table=os.environ.get("BETTERSTACK_SOURCE_TABLE","").strip()
    rnd_key=os.environ.get("RENDER_API_KEY","").strip() or os.environ.get("RENDER_TOKEN","").strip()
    rnd_sid=os.environ.get("RENDER_SERVICE_ID","").strip()
    rnd_sids=os.environ.get("RENDER_SERVICE_IDS","").strip()

    if args.list_sources:
        if not bt_token:
            print("Set BETTERSTACK_API_TOKEN in .env.logs", file=sys.stderr); sys.exit(1)
        data=betterstack_list_sources(bt_token)
        if data: print(json.dumps(data, indent=2))
        return

    # Auto selection: v2 API > SQL API > Render API
    src=args.source
    if src=="auto":
        if bt_token and bt_source_id:
            src="betterstack"
        elif bt_host and bt_user and bt_pwd and bt_table:
            src="betterstack"
        elif bt_token:
            # has token but no source/SQL -> will guide
            src="betterstack"
        elif rnd_key and (rnd_sid or rnd_sids):
            src="render"
        else:
            src="help"

    if src=="betterstack":
        q=args.query
        fetch_limit=args.tail*4 if args.errors else args.tail
        if bt_token and bt_source_id:
            rows=betterstack_query_v2(
                bt_token,
                bt_source_id,
                query_filter=q,
                limit=fetch_limit,
                start_time=args.since,
            )
            if rows is None: sys.exit(1)
            if args.errors:
                rows=filter_errors(rows)
                rows=rows[:args.tail]
            render_rows(rows)
            print(f"\n[done] {len(rows)} log(s) from BetterStack source {bt_source_id} ({args.since})", file=sys.stderr)
        elif bt_host and bt_user and bt_pwd and bt_table:
            rows=betterstack_query_sql(bt_host, bt_user, bt_pwd, bt_table, query_filter=q, limit=fetch_limit)
            if rows is None: sys.exit(1)
            if args.errors:
                rows=filter_errors(rows)
                rows=rows[:args.tail]
            render_rows(rows)
            print(f"\n[done] {len(rows)} log(s) from BetterStack {bt_table} @ {bt_host}", file=sys.stderr)
        else:
            if not bt_token:
                print("No BETTERSTACK_API_TOKEN or SQL creds in .env.logs", file=sys.stderr)
                print("Add either SQL creds (preferred) or RENDER_API_KEY+SERVICE_ID", file=sys.stderr)
                sys.exit(1)
            betterstack_fetch_via_telemetry_fallback(bt_token, args.tail)
            # fallback to Render if available
            if rnd_key and (rnd_sid or rnd_sids):
                print("\n[Fallback] Trying Render...", file=sys.stderr)
                ids=[rnd_sid] if rnd_sid else []
                if rnd_sids: ids+= [x.strip() for x in rnd_sids.split(",") if x.strip()]
                for sid in ids:
                    render_fetch(sid, rnd_key, tail=args.tail)
        return
    elif src=="render":
        if not rnd_key:
            print("Set RENDER_API_KEY in .env.logs", file=sys.stderr); sys.exit(1)
        ids=[]
        if rnd_sids: ids=[x.strip() for x in rnd_sids.split(",") if x.strip()]
        elif rnd_sid: ids=[rnd_sid]
        else:
            print("Set RENDER_SERVICE_ID or RENDER_SERVICE_IDS in .env.logs", file=sys.stderr); sys.exit(1)
        for sid in ids:
            print(f"\n=== Render service {sid} ===")
            render_fetch(sid, rnd_key, tail=args.tail)
        return
    else:
        print("No log source configured. See .env.logs.example:")
        print("  BETTERSTACK_API_TOKEN + BETTERSTACK_SQL_HOST/USER/PASSWORD/TABLE  (live logs, preferred)")
        print("  RENDER_API_KEY + RENDER_SERVICE_ID  (deploy logs)")
        print(f"\nEnv file: {ENV_PATH} (exists={ENV_PATH.exists()})")
        if ENV_PATH.exists():
            print(ENV_PATH.read_text()[:800])
        sys.exit(1)

if __name__=="__main__":
    main()
