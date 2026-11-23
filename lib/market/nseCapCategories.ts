/**
 * Authoritative Indian market-cap buckets from NSE index membership.
 *
 * Provider market caps are usually reliable, but a wrong value (for example a
 * USD market cap returned for an INR quote) silently moves a large bank into
 * the small-cap bucket. NSE publishes the constituents of the three AMFI cap
 * buckets, so index membership is a safer source than a single quote field.
 *
 * The lists change only at index rebalances, so they are cached in memory for
 * half a day. Two official hosts are queried in parallel because some hosted
 * runtimes cannot reach NSE's Akamai edge. A committed snapshot is the final
 * fallback, so a blocked refresh can never misclassify a Nifty 100 stock.
 */

import { setDefaultResultOrder } from 'node:dns';

import {
  NSE_CAP_FALLBACK,
  type NseCapCategory,
} from './nseCapFallback';

// NSE publishes AAAA records that some hosted runtimes cannot route. Prefer
// IPv4 here as well as in the price route so the refresh is not a coin flip.
setDefaultResultOrder('ipv4first');

const NSE_ARCHIVE_BASE = 'https://nsearchives.nseindia.com/content/indices';
const NIFTY_INDICES_BASE = 'https://www.niftyindices.com/IndexConstituent';
const CAP_SOURCES = [NSE_ARCHIVE_BASE, NIFTY_INDICES_BASE];

const CAP_LISTS: Array<{
  file: string;
  category: NseCapCategory;
  minSymbols: number;
}> = [
  { file: 'ind_nifty100list.csv', category: 'Large Cap', minSymbols: 90 },
  { file: 'ind_niftymidcap150list.csv', category: 'Mid Cap', minSymbols: 135 },
  { file: 'ind_niftysmallcap250list.csv', category: 'Small Cap', minSymbols: 225 },
];

const LIST_TTL_MS = 12 * 60 * 60 * 1000;
// A failed or partial refresh keeps the snapshot, but retry well before the
// full TTL so a transient block does not pin stale membership for half a day.
const RETRY_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

type CapCategory = NseCapCategory;

let cached: { map: Map<string, CapCategory>; expires: number } = {
  // The committed snapshot is the cold-start answer. It is replaced by the
  // live lists after the background refresh finishes.
  map: new Map(Object.entries(NSE_CAP_FALLBACK)),
  expires: 0,
};
let inflight: Promise<void> | null = null;

/** Minimal RFC-4180-style parser so quoted company names with commas do not shift columns. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

function parseCapList(csv: string, category: CapCategory): Array<[string, CapCategory]> {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length < 2) return [];

  // Header: Company Name, Industry, Symbol, Series, ISIN Code
  const header = parseCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const symbolIndex = header.indexOf('symbol');
  if (symbolIndex < 0) return [];

  const entries: Array<[string, CapCategory]> = [];
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const symbol = parseCsvLine(line)[symbolIndex]?.trim().toUpperCase();
    if (symbol) entries.push([symbol, category]);
  }
  return entries;
}

async function fetchCsv(file: string): Promise<string> {
  const attempts = CAP_SOURCES.map(async (base) => {
    const response = await fetch(`${base}/${file}`, {
      headers: {
        Accept: 'text/csv,text/plain,*/*',
        'User-Agent': 'AssetTracker/0.1',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`${base} responded with ${response.status}`);
    }

    const csv = await response.text();
    // A bot challenge is served as HTML with a 200, so validate the payload.
    if (!csv.toLowerCase().includes('symbol')) {
      throw new Error(`${base} returned an unexpected payload`);
    }
    return csv;
  });

  return Promise.any(attempts);
}

async function fetchCapList(
  file: string,
  category: CapCategory,
  minSymbols: number,
  map: Map<string, CapCategory>,
) {
  const csv = await fetchCsv(file);
  const entries = parseCapList(csv, category);
  if (entries.length < minSymbols) {
    throw new Error(
      `NSE ${file} contained ${entries.length} symbols (expected at least ${minSymbols})`,
    );
  }
  for (const [symbol, cap] of entries) map.set(symbol, cap);
}

async function loadCapCategories(): Promise<Map<string, CapCategory>> {
  // Seed with the committed snapshot. Live lists overwrite it when reachable.
  const map = new Map<string, CapCategory>(Object.entries(NSE_CAP_FALLBACK));
  const results = await Promise.allSettled(
    CAP_LISTS.map(({ file, category, minSymbols }) =>
      fetchCapList(file, category, minSymbols, map),
    ),
  );

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.warn(
      `[nse-cap] ${failures.length}/${CAP_LISTS.length} index lists failed to refresh; using snapshot fallback`,
    );
  }

  cached = {
    map,
    expires: Date.now() + (failures.length === 0 ? LIST_TTL_MS : RETRY_TTL_MS),
  };
  return map;
}

function refreshCapCategories(): void {
  if (inflight) return;

  inflight = loadCapCategories()
    .then(() => undefined)
    .catch((error: any) => {
      console.warn('[nse-cap] index list load failed:', error?.message || error);
      cached = {
        map: new Map(Object.entries(NSE_CAP_FALLBACK)),
        expires: Date.now() + RETRY_TTL_MS,
      };
    })
    .finally(() => {
      inflight = null;
    });
}

/**
 * Returns a symbol -> cap-category map for the Nifty 100, Midcap 150 and
 * Smallcap 250. The committed snapshot is returned immediately; the official
 * lists refresh in the background so a slow or blocked host never delays a
 * quote response. Never throws.
 */
export function getNseCapCategories(): Promise<Map<string, CapCategory>> {
  if (Date.now() >= cached.expires) refreshCapCategories();
  return Promise.resolve(cached.map);
}
