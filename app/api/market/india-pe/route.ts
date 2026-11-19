import { get as httpsGet } from 'node:https';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * NSE publishes the end-of-day valuation file for every headline index at a
 * stable, keyless URL. Downstox mirrors the same NSE readings as monthly
 * history, which gives the current P/E a comparable five-year baseline.
 */
const NSE_URL = 'https://nsearchives.nseindia.com/content/indices/ind_close_all.csv';
const DOWNSTOX_BASE = 'https://downstox.com/api/index-pe';

const CACHE_MS = 60 * 60_000;
const SHORT_CACHE_MS = 15 * 60_000;
const STALE_CACHE_MS = 5 * 60_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const UPSTREAM_ATTEMPTS = 2;
const HISTORY_MONTHS = 60;
const MIN_HISTORY_MONTHS = 24;

const INDEX_CONFIG = [
  { key: 'nifty50', name: 'Nifty 50', slug: 'nifty-50' },
  { key: 'niftyBank', name: 'Nifty Bank', slug: 'nifty-bank' },
  { key: 'niftyIt', name: 'Nifty IT', slug: 'nifty-it' },
  { key: 'niftyMidcap100', name: 'NIFTY Midcap 100', slug: 'nifty-midcap-100' },
] as const;

type IndexKey = (typeof INDEX_CONFIG)[number]['key'];

interface IndexHistory {
  sampleMonths: number;
  medianPe: number | null;
  /** Share of the window with a lower P/E; 0 is cheapest. */
  percentile: number | null;
  start: string | null;
  end: string | null;
}

interface IndexValuation {
  key: IndexKey;
  name: string;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  earningsYield: number | null;
  history: IndexHistory | null;
}

interface IndiaPeData {
  asOf: string | null;
  source: 'nse' | 'downstox' | 'mixed' | null;
  stale: boolean;
  indices: IndexValuation[];
}

interface NseRow {
  name: string;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
}

interface NseSnapshot {
  asOf: string | null;
  rows: Map<string, NseRow>;
}

interface DownstoxMonth {
  year: number;
  month: number;
  pe: number;
}

interface DownstoxSnapshot {
  currentPe: number | null;
  currentPb: number | null;
  currentDividendYield: number | null;
  monthly: DownstoxMonth[];
  asOf: string | null;
}

let cache: { data: IndiaPeData; expiresAt: number } | null = null;

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'string' && (value.trim() === '' || value.trim() === '-')) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = parseNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function dateToIso(value: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

interface TextResponse {
  status: number;
  body: string;
}

/**
 * Node's global fetch resolves both A and AAAA records; on this Termux host an
 * unreachable IPv6 path stalls every request until the connect timeout. The
 * NSE and Downstox hosts are IPv4-reachable, so pin the socket family and keep
 * retries for slow first connections.
 */
function httpsGetText(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<TextResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      {
        family: 4,
        headers: { ...headers, 'Accept-Encoding': 'identity' },
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          response.resume();
          resolve({ status, body: '' });
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 2_000_000) {
            response.destroy(new Error('response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          resolve({ status, body: Buffer.concat(chunks).toString('utf8') });
        });
        response.on('error', reject);
      },
    );

    request.on('timeout', () => request.destroy(new Error(`timed out after ${timeoutMs}ms`)));
    request.on('error', reject);
  });
}

async function httpsGetTextWithRetry(
  url: string,
  headers: Record<string, string>,
  label: string,
): Promise<TextResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < UPSTREAM_ATTEMPTS; attempt += 1) {
    try {
      return await httpsGetText(url, headers, UPSTREAM_TIMEOUT_MS);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} request failed`);
}

function parseNseCsv(csv: string): NseSnapshot | null {
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2 || !lines[0].includes('Index Name')) return null;

  const rows = new Map<string, NseRow>();
  let asOf: string | null = null;

  for (const line of lines.slice(1)) {
    // The NSE file has exactly 13 unquoted columns; index names never contain
    // commas, so a split is sufficient and avoids a CSV dependency.
    const cols = line.split(',');
    if (cols.length < 13) continue;

    const name = cols[0].trim();
    if (!name) continue;

    asOf ??= dateToIso(cols[1]);
    rows.set(name.toLowerCase(), {
      name,
      pe: positiveNumber(cols[10]),
      pb: positiveNumber(cols[11]),
      dividendYield: nonNegativeNumber(cols[12]),
    });
  }

  return rows.size > 0 ? { asOf, rows } : null;
}

async function fetchNseSnapshot(): Promise<NseSnapshot | null> {
  try {
    const response = await httpsGetTextWithRetry(
      NSE_URL,
      {
        Accept: 'text/csv,text/plain,*/*',
        'User-Agent': 'AssetTracker/0.1',
      },
      'NSE',
    );
    if (response.status !== 200) {
      throw new Error(`NSE responded with ${response.status}`);
    }

    const csv = response.body;
    if (!csv.startsWith('Index Name')) {
      throw new Error('NSE did not return the index valuation CSV');
    }

    const snapshot = parseNseCsv(csv);
    if (!snapshot) {
      throw new Error('NSE index valuation CSV had no usable rows');
    }
    return snapshot;
  } catch (error) {
    console.error('[india-pe] NSE snapshot failed:', error);
    return null;
  }
}

async function fetchDownstox(slug: string): Promise<DownstoxSnapshot | null> {
  try {
    const response = await httpsGetTextWithRetry(
      `${DOWNSTOX_BASE}/${slug}`,
      {
        Accept: 'application/json',
        'User-Agent': 'AssetTracker/0.1',
      },
      `Downstox ${slug}`,
    );
    if (response.status !== 200) {
      throw new Error(`Downstox responded with ${response.status}`);
    }

    const payload = JSON.parse(response.body) as {
      success?: boolean;
      data?: {
        current?: { pe?: unknown; pb?: unknown; divYield?: unknown };
        monthly?: Array<{ year?: unknown; month?: unknown; pe?: unknown }>;
        asOf?: unknown;
      };
    };
    if (payload.success !== true || !payload.data) return null;

    const monthly: DownstoxMonth[] = [];
    for (const row of Array.isArray(payload.data.monthly) ? payload.data.monthly : []) {
      const pe = positiveNumber(row?.pe);
      if (typeof row?.year === 'number' && typeof row?.month === 'number' && pe != null) {
        monthly.push({ year: row.year, month: row.month, pe });
      }
    }
    monthly.sort((a, b) => a.year - b.year || a.month - b.month);

    return {
      currentPe: positiveNumber(payload.data.current?.pe),
      currentPb: positiveNumber(payload.data.current?.pb),
      currentDividendYield: nonNegativeNumber(payload.data.current?.divYield),
      monthly,
      asOf: typeof payload.data.asOf === 'string' ? payload.data.asOf : null,
    };
  } catch (error) {
    console.error(`[india-pe] Downstox ${slug} failed:`, error);
    return null;
  }
}

function monthKey(value: { year: number; month: number }): string {
  return `${value.year}-${String(value.month + 1).padStart(2, '0')}`;
}

function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
}

function buildHistory(
  downstox: DownstoxSnapshot | null,
  currentPe: number | null,
): IndexHistory | null {
  if (!downstox) return null;

  const window = downstox.monthly.slice(-HISTORY_MONTHS);
  if (window.length < MIN_HISTORY_MONTHS) return null;

  const values = window.map((row) => row.pe).sort((a, b) => a - b);
  const reference =
    currentPe ?? downstox.currentPe ?? window[window.length - 1]?.pe ?? null;
  const percentile =
    reference != null
      ? Math.round((values.filter((value) => value < reference).length / values.length) * 1000) / 10
      : null;

  return {
    sampleMonths: window.length,
    medianPe: median(values),
    percentile,
    start: monthKey(window[0]),
    end: monthKey(window[window.length - 1]),
  };
}

function buildData(
  nse: NseSnapshot | null,
  downstoxSnapshots: (DownstoxSnapshot | null)[],
): IndiaPeData {
  let usedNse = false;
  let usedDownstox = false;

  const indices = INDEX_CONFIG.map((config, index) => {
    const nseRow = nse?.rows.get(config.name.toLowerCase()) ?? null;
    const downstox = downstoxSnapshots[index] ?? null;

    const pe = nseRow?.pe ?? downstox?.currentPe ?? null;
    if (nseRow?.pe != null) usedNse = true;
    else if (downstox?.currentPe != null) usedDownstox = true;

    return {
      key: config.key,
      name: nseRow?.name ?? config.name,
      pe,
      pb: nseRow?.pb ?? downstox?.currentPb ?? null,
      dividendYield: nseRow?.dividendYield ?? downstox?.currentDividendYield ?? null,
      earningsYield: pe != null && pe > 0 ? 100 / pe : null,
      history: buildHistory(downstox, pe),
    };
  });

  const source =
    usedNse && usedDownstox ? 'mixed' : usedNse ? 'nse' : usedDownstox ? 'downstox' : null;
  const asOf =
    nse?.asOf ?? downstoxSnapshots.find((snapshot) => snapshot?.asOf)?.asOf ?? null;

  return { asOf, source, stale: false, indices };
}

function cacheHeadersFor(ttlMs: number): Record<string, string> {
  const seconds = Math.ceil(ttlMs / 1000);
  return {
    'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${seconds / 2}`,
  };
}

/** Retry sooner while a history baseline is missing. */
function cacheTtlFor(data: IndiaPeData): number {
  return data.indices.some((index) => index.history == null) ? SHORT_CACHE_MS : CACHE_MS;
}

export async function GET() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(
      { success: true, data: cache.data },
      { headers: cacheHeadersFor(cache.expiresAt - now) },
    );
  }

  const [nse, ...downstoxSnapshots] = await Promise.all([
    fetchNseSnapshot(),
    ...INDEX_CONFIG.map((config) => fetchDownstox(config.slug)),
  ]);
  const data = buildData(nse, downstoxSnapshots);

  if (!data.indices.some((index) => index.pe != null)) {
    if (cache) {
      const staleData = { ...cache.data, stale: true };
      cache = { data: staleData, expiresAt: now + STALE_CACHE_MS };
      return NextResponse.json(
        { success: true, data: staleData },
        { headers: cacheHeadersFor(STALE_CACHE_MS) },
      );
    }

    return NextResponse.json(
      { success: false, error: 'Indian index valuations are unavailable right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const ttl = cacheTtlFor(data);
  cache = { data, expiresAt: now + ttl };
  return NextResponse.json(
    { success: true, data },
    { headers: cacheHeadersFor(ttl) },
  );
}
