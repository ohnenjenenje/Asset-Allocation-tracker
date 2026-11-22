/**
 * Authoritative Indian market-cap buckets from NSE index membership.
 *
 * Provider market caps are usually reliable, but a wrong value (for example a
 * USD market cap returned for an INR quote) silently moves a large bank into
 * the small-cap bucket. NSE publishes the constituents of the three AMFI cap
 * buckets, so index membership is a safer source than a single quote field.
 *
 * The lists change only at index rebalances, so they are cached in memory for
 * half a day. A failed refresh is retried sooner instead of being cached for
 * the full TTL.
 */

const NSE_ARCHIVE_BASE = 'https://nsearchives.nseindia.com/content/indices';

const CAP_LISTS: Array<{ file: string; category: 'Large Cap' | 'Mid Cap' | 'Small Cap' }> = [
  { file: 'ind_nifty100list.csv', category: 'Large Cap' },
  { file: 'ind_niftymidcap150list.csv', category: 'Mid Cap' },
  { file: 'ind_niftysmallcap250list.csv', category: 'Small Cap' },
];

const LIST_TTL_MS = 12 * 60 * 60 * 1000;
const EMPTY_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6_000;

type CapCategory = 'Large Cap' | 'Mid Cap' | 'Small Cap';

let cached: { map: Map<string, CapCategory>; expires: number } | null = null;
let inflight: Promise<Map<string, CapCategory>> | null = null;

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

async function fetchCapList(
  file: string,
  category: CapCategory,
  map: Map<string, CapCategory>,
) {
  const response = await fetch(`${NSE_ARCHIVE_BASE}/${file}`, {
    headers: {
      Accept: 'text/csv,text/plain,*/*',
      'User-Agent': 'AssetTracker/0.1',
    },
    cache: 'no-store',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`NSE ${file} responded with ${response.status}`);
  }

  const csv = await response.text();
  const lines = csv.split(/\r?\n/);
  if (lines.length < 2) return;

  // Header: Company Name, Industry, Symbol, Series, ISIN Code
  const header = parseCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const symbolIndex = header.indexOf('symbol');
  if (symbolIndex < 0) return;

  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const cells = parseCsvLine(line);
    const symbol = cells[symbolIndex]?.trim().toUpperCase();
    if (symbol) map.set(symbol, category);
  }
}

async function loadCapCategories(): Promise<Map<string, CapCategory>> {
  const map = new Map<string, CapCategory>();
  const results = await Promise.allSettled(
    CAP_LISTS.map(({ file, category }) => fetchCapList(file, category, map)),
  );

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.warn(
      `[nse-cap] ${failures.length}/${CAP_LISTS.length} index lists failed to load`,
    );
  }

  cached = {
    map,
    expires: Date.now() + (map.size > 0 ? LIST_TTL_MS : EMPTY_TTL_MS),
  };
  return map;
}

/**
 * Returns a symbol -> cap-category map for the Nifty 100, Midcap 150 and
 * Smallcap 250. Never throws: callers fall back to quote market caps.
 */
export async function getNseCapCategories(): Promise<Map<string, CapCategory>> {
  if (cached && Date.now() < cached.expires) return cached.map;
  if (inflight) return inflight;

  inflight = loadCapCategories().finally(() => {
    inflight = null;
  });

  try {
    return await inflight;
  } catch (error: any) {
    console.warn('[nse-cap] index list load failed:', error?.message || error);
    cached = { map: new Map(), expires: Date.now() + EMPTY_TTL_MS };
    return cached.map;
  }
}
