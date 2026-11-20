import { get as httpsGet, request as httpsRequest } from 'node:https';
import { NextResponse } from 'next/server';

import clientPromise from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * NSE publishes the end-of-day valuation file for every headline index at a
 * stable, keyless URL. It also archives the same file by date, which lets us
 * build a monthly P/E history for every index without paying for a data feed.
 * Downstox mirrors the same NSE readings and is kept as a fallback for the
 * liquid indices it covers.
 */
const NSE_URL = 'https://nsearchives.nseindia.com/content/indices/ind_close_all.csv';
const NSE_ARCHIVE_BASE = 'https://nsearchives.nseindia.com/content/indices/ind_close_all_';
const DOWNSTOX_BASE = 'https://downstox.com/api/index-pe';
/**
 * Nifty Indices' own historical valuation endpoint. Unlike the public CSV it
 * remains reachable from cloud hosts that NSE blocks, and it covers every
 * official sectoral index. It needs a browser-like request and one call per
 * index, so it is only used for values the cheaper feeds could not supply.
 */
const NIFTY_INDICES_URL =
  'https://www.niftyindices.com/BackPage/getpepbHistoricaldataDBtoString';
const NIFTY_INDICES_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36';

const CACHE_MS = 60 * 60_000;
const SHORT_CACHE_MS = 15 * 60_000;
const STALE_CACHE_MS = 5 * 60_000;
const UPSTREAM_TIMEOUT_MS = 8_000;
const ARCHIVE_TIMEOUT_MS = 10_000;
const HISTORY_TOTAL_TIMEOUT_MS = 18_000;
const UPSTREAM_ATTEMPTS = 2;
const DOWNSTOX_TIMEOUT_MS = 12_000;
const DOWNSTOX_FALLBACK_TIMEOUT_MS = 12_000;
const NIFTY_INDICES_TIMEOUT_MS = 10_000;
const NIFTY_INDICES_TOTAL_TIMEOUT_MS = 20_000;
/** A fresh, short budget lets Nifty fill gaps left by a failed Downstox call. */
const NIFTY_INDICES_SECOND_WAVE_TIMEOUT_MS = 8_000;
const NIFTY_INDICES_CONCURRENCY = 6;
const MONGO_CONNECT_TIMEOUT_MS = 8_000;
const MONGO_QUERY_TIMEOUT_MS = 2_000;
const HISTORY_MONTHS = 60;
const MIN_HISTORY_MONTHS = 24;
const HISTORY_CONCURRENCY = 6;
const HISTORY_CACHE_MS = 24 * 60 * 60_000;
const PARTIAL_HISTORY_CACHE_MS = 60 * 60_000;
const CURRENT_CACHE_MS = 24 * 60 * 60_000;
/** Only persist a cold rebuild that is close to the full five-year window. */
const HISTORY_WRITE_MIN_MONTHS = 48;

const MONGO_DB = 'portfolio_tracker';
const MONGO_COLLECTION = 'market_cache';
const MONGO_HISTORY_ID = 'india-pe-monthly-v1';
const MONGO_CURRENT_ID = 'india-pe-current-v1';

type IndexCategory = 'broad' | 'sector' | 'thematic';
type ValuationSource = 'nse' | 'downstox' | 'nifty-indices';

interface IndexConfig {
  key: string;
  name: string;
  /** Exact name in NSE's current file. Historical files are matched after normalization. */
  nseName: string;
  /** Nifty Indices trading name when it differs from the display/NSE name. */
  niftyName?: string;
  downstoxSlug: string | null;
  category: IndexCategory;
  featured: boolean;
}

/**
 * The 34 indices on Nifty Indices' official sectoral list, plus the broad
 * indices used by the headline card and the commonly followed thematic
 * indices that are treated as sectors in practice. Keeping the list explicit
 * avoids picking up bond, strategy and custom indices from the NSE file.
 */
const INDEX_CONFIG: IndexConfig[] = [
  { key: 'nifty50', name: 'Nifty 50', nseName: 'Nifty 50', downstoxSlug: 'nifty-50', category: 'broad', featured: true },
  { key: 'niftyMidcap100', name: 'Nifty Midcap 100', nseName: 'NIFTY Midcap 100', downstoxSlug: 'nifty-midcap-100', category: 'broad', featured: true },
  { key: 'niftyBank', name: 'Nifty Bank', nseName: 'Nifty Bank', downstoxSlug: 'nifty-bank', category: 'sector', featured: true },
  { key: 'niftyIt', name: 'Nifty IT', nseName: 'Nifty IT', downstoxSlug: 'nifty-it', category: 'sector', featured: true },
  { key: 'niftyAuto', name: 'Nifty Auto', nseName: 'Nifty Auto', downstoxSlug: 'nifty-auto', category: 'sector', featured: false },
  { key: 'niftyCapitalGoods', name: 'Nifty Capital Goods', nseName: 'Nifty Capital Goods', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyCement', name: 'Nifty Cement', nseName: 'Nifty Cement', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyChemicals', name: 'Nifty Chemicals', nseName: 'Nifty Chemicals', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyCommercialTransport', name: 'Nifty Commercial & Transport Services', nseName: 'Nifty Commercial & Transport Services', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyConstruction', name: 'Nifty Construction', nseName: 'Nifty Construction', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyConsumerDurables', name: 'Nifty Consumer Durables', nseName: 'Nifty Consumer Durables', niftyName: 'NIFTY CONSR DURBL', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyConsumerServices', name: 'Nifty Consumer Services', nseName: 'Nifty Consumer Services', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyFinancialServices', name: 'Nifty Financial Services', nseName: 'Nifty Financial Services', niftyName: 'Nifty Fin Service', downstoxSlug: 'nifty-financial-services', category: 'sector', featured: false },
  { key: 'niftyFinancialServices2550', name: 'Nifty Financial Services 25/50', nseName: 'Nifty Financial Services 25/50', niftyName: 'NIFTY FINSRV25 50', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyFinancialServicesExBank', name: 'Nifty Financial Services Ex-Bank', nseName: 'Nifty Financial Services Ex-Bank', niftyName: 'Nifty FinSerExBnk', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyFmcg', name: 'Nifty FMCG', nseName: 'Nifty FMCG', downstoxSlug: 'nifty-fmcg', category: 'sector', featured: false },
  { key: 'niftyHealthcare', name: 'Nifty Healthcare', nseName: 'Nifty Healthcare Index', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyHospitals', name: 'Nifty Hospitals', nseName: 'Nifty Hospitals', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyHousingFinance', name: 'Nifty Housing Finance', nseName: 'Nifty Housing Finance', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyInsurance', name: 'Nifty Insurance', nseName: 'Nifty Insurance', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyMedia', name: 'Nifty Media', nseName: 'Nifty Media', downstoxSlug: 'nifty-media', category: 'sector', featured: false },
  { key: 'niftyMetal', name: 'Nifty Metal', nseName: 'Nifty Metal', downstoxSlug: 'nifty-metal', category: 'sector', featured: false },
  { key: 'niftyNbfc', name: 'Nifty NBFC', nseName: 'Nifty NBFC', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyOilGas', name: 'Nifty Oil & Gas', nseName: 'Nifty Oil & Gas', niftyName: 'NIFTY OIL AND GAS', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyPharma', name: 'Nifty Pharma', nseName: 'Nifty Pharma', downstoxSlug: 'nifty-pharma', category: 'sector', featured: false },
  { key: 'niftyPower', name: 'Nifty Power', nseName: 'Nifty Power', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyPrivateBank', name: 'Nifty Private Bank', nseName: 'Nifty Private Bank', niftyName: 'Nifty Pvt Bank', downstoxSlug: 'nifty-private-bank', category: 'sector', featured: false },
  { key: 'niftyPsuBank', name: 'Nifty PSU Bank', nseName: 'Nifty PSU Bank', downstoxSlug: 'nifty-psu-bank', category: 'sector', featured: false },
  { key: 'niftyRealty', name: 'Nifty Realty', nseName: 'Nifty Realty', downstoxSlug: 'nifty-realty', category: 'sector', featured: false },
  { key: 'niftyReitsRealty', name: 'Nifty REITs & Realty', nseName: 'Nifty REITs & Realty', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyRetail', name: 'Nifty Retail', nseName: 'Nifty Retail', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyTelecom', name: 'Nifty Telecommunications', nseName: 'Nifty Telecommunications', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'nifty500Healthcare', name: 'Nifty500 Healthcare', nseName: 'Nifty500 Healthcare', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyMidSmallFinancialServices', name: 'Nifty MidSmall Financial Services', nseName: 'Nifty MidSmall Financial Services', niftyName: 'Nifty MS Fin Serv', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyMidSmallHealthcare', name: 'Nifty MidSmall Healthcare', nseName: 'Nifty MidSmall Healthcare', niftyName: 'NIFTY MIDSML HLTH', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyMidSmallItTelecom', name: 'Nifty MidSmall IT & Telecom', nseName: 'Nifty MidSmall IT & Telecom', niftyName: 'Nifty MS IT Telcm', downstoxSlug: null, category: 'sector', featured: false },
  { key: 'niftyEnergy', name: 'Nifty Energy', nseName: 'Nifty Energy', downstoxSlug: 'nifty-energy', category: 'thematic', featured: false },
  { key: 'niftyInfrastructure', name: 'Nifty Infrastructure', nseName: 'Nifty Infrastructure', niftyName: 'Nifty Infra', downstoxSlug: 'nifty-infra', category: 'thematic', featured: false },
  { key: 'niftyConsumption', name: 'Nifty India Consumption', nseName: 'Nifty India Consumption', niftyName: 'Nifty Consumption', downstoxSlug: 'nifty-consumption', category: 'thematic', featured: false },
  { key: 'niftyCommodities', name: 'Nifty Commodities', nseName: 'Nifty Commodities', downstoxSlug: 'nifty-commodities', category: 'thematic', featured: false },
  { key: 'niftyPse', name: 'Nifty PSE', nseName: 'Nifty PSE', downstoxSlug: null, category: 'thematic', featured: false },
  { key: 'niftyCpse', name: 'Nifty CPSE', nseName: 'Nifty CPSE', downstoxSlug: 'nifty-cpse', category: 'thematic', featured: false },
  { key: 'niftyMnc', name: 'Nifty MNC', nseName: 'Nifty MNC', downstoxSlug: null, category: 'thematic', featured: false },
  { key: 'niftyServices', name: 'Nifty Services Sector', nseName: 'Nifty Services Sector', niftyName: 'Nifty Serv Sector', downstoxSlug: null, category: 'thematic', featured: false },
  { key: 'niftyDefence', name: 'Nifty India Defence', nseName: 'Nifty India Defence', niftyName: 'Nifty Ind Defence', downstoxSlug: null, category: 'thematic', featured: false },
];

const NSE_INDEX_KEYS = new Set(INDEX_CONFIG.map((config) => normalizeIndexName(config.nseName)));

interface IndexHistory {
  sampleMonths: number;
  medianPe: number | null;
  /** Share of the window with a lower P/E; 0 is cheapest. */
  percentile: number | null;
  start: string | null;
  end: string | null;
}

interface IndexValuation {
  key: string;
  name: string;
  category: IndexCategory;
  featured: boolean;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  earningsYield: number | null;
  history: IndexHistory | null;
  historySource: 'nse' | 'downstox' | null;
  /** Where the current P/E/P/B/yield came from. */
  currentSource: ValuationSource | null;
}

interface IndiaPeData {
  asOf: string | null;
  source: ValuationSource | 'mixed' | null;
  /** Every feed that supplied at least one current value. */
  sources: ValuationSource[];
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

interface MonthlyPe {
  year: number;
  /** Zero-indexed, matching Downstox's monthly payload. */
  month: number;
  pe: number;
}

type MonthlyHistory = Map<string, MonthlyPe[]>;

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

interface StoredHistory {
  _id: string;
  updatedAt: Date;
  monthsFound: number;
  monthly: Record<string, MonthlyPe[]>;
}

interface NiftyCurrentValue {
  pe: number;
  pb: number | null;
  dividendYield: number | null;
  asOf: string | null;
  fetchedAt: string;
}

type NiftyCurrentMap = Map<string, NiftyCurrentValue>;

interface StoredCurrent {
  _id: string;
  updatedAt: Date;
  values: Record<string, NiftyCurrentValue>;
}

let cache: { data: IndiaPeData; expiresAt: number } | null = null;
let historyCache: { monthly: MonthlyHistory; monthsFound: number; expiresAt: number } | null = null;
let currentCache: { values: NiftyCurrentMap; expiresAt: number } | null = null;
let historyRefresh: Promise<{
  monthly: MonthlyHistory;
  monthsFound: number;
}> | null = null;

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

/** Matches "Oil & Gas", "Oil and Gas" and "… Index" across NSE file vintages. */
function normalizeIndexName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+index$/, '')
    .trim();
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

function httpsPostJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<TextResponse> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(body, 'utf8');
    const request = httpsRequest(
      url,
      {
        method: 'POST',
        family: 4,
        headers: {
          ...headers,
          'Accept-Encoding': 'identity',
          'Content-Length': String(payload.length),
        },
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
    request.end(payload);
  });
}

async function httpsGetTextWithRetry(
  url: string,
  headers: Record<string, string>,
  label: string,
  timeoutMs = UPSTREAM_TIMEOUT_MS,
  attempts = UPSTREAM_ATTEMPTS,
): Promise<TextResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await httpsGetText(url, headers, timeoutMs);
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
    const key = normalizeIndexName(name);
    if (!NSE_INDEX_KEYS.has(key)) continue;

    rows.set(key, {
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

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** The last 60 completed calendar months, oldest first. */
function completedMonths(count: number): Array<{ year: number; month: number }> {
  const now = new Date();
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const months: Array<{ year: number; month: number }> = [];

  for (let index = 0; index < count; index += 1) {
    months.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() });
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }

  return months.reverse();
}

/**
 * Month-end files land on the last trading day, so a weekend or holiday date
 * falls back to the preceding weekday. Only a 404 triggers that walk-back; a
 * network error retries once and then gives up on the month.
 */
async function fetchNseArchiveMonth(
  year: number,
  month: number,
  deadline: number,
): Promise<string | null> {
  for (let back = 0; back < 8; back += 1) {
    if (Date.now() > deadline) return null;

    const date = new Date(Date.UTC(year, month + 1, 0 - back));
    const url = `${NSE_ARCHIVE_BASE}${pad2(date.getUTCDate())}${pad2(
      date.getUTCMonth() + 1,
    )}${date.getUTCFullYear()}.csv`;
    const headers = {
      Accept: 'text/csv,text/plain,*/*',
      'User-Agent': 'AssetTracker/0.1',
    };

    /** A socket error or timeout should lose one month, not the whole refresh. */
    const requestDate = async (timeoutMs: number): Promise<TextResponse | null> => {
      try {
        return await httpsGetText(url, headers, timeoutMs);
      } catch {
        return null;
      }
    };

    const firstRemaining = deadline - Date.now();
    if (firstRemaining <= 0) return null;
    const response = await requestDate(Math.min(ARCHIVE_TIMEOUT_MS, firstRemaining));
    if (response?.status === 200 && response.body.startsWith('Index Name')) {
      return response.body;
    }
    if (response?.status === 404) continue;

    const retryRemaining = deadline - Date.now();
    if (retryRemaining <= 0) return null;
    const retry = await requestDate(Math.min(ARCHIVE_TIMEOUT_MS, retryRemaining));
    if (retry?.status === 200 && retry.body.startsWith('Index Name')) {
      return retry.body;
    }
    return null;
  }

  return null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
  return results;
}

async function fetchNseMonthlyHistory(): Promise<{
  monthly: MonthlyHistory;
  monthsFound: number;
}> {
  const months = completedMonths(HISTORY_MONTHS);
  const deadline = Date.now() + HISTORY_TOTAL_TIMEOUT_MS;
  const snapshots = await mapWithConcurrency(
    months,
    HISTORY_CONCURRENCY,
    async ({ year, month }) => {
      const body = await fetchNseArchiveMonth(year, month, deadline);
      return body ? { year, month, body } : null;
    },
  );

  const monthly: MonthlyHistory = new Map();
  let monthsFound = 0;

  for (const snapshot of snapshots) {
    if (!snapshot) continue;
    const parsed = parseNseCsv(snapshot.body);
    if (!parsed) continue;
    monthsFound += 1;

    for (const [key, row] of parsed.rows) {
      if (row.pe == null) continue;
      const list = monthly.get(key) ?? [];
      list.push({ year: snapshot.year, month: snapshot.month, pe: row.pe });
      monthly.set(key, list);
    }
  }

  for (const list of monthly.values()) {
    list.sort((a, b) => a.year - b.year || a.month - b.month);
  }

  console.log(
    `[india-pe] NSE archive history: ${monthsFound}/${HISTORY_MONTHS} months, ${monthly.size} indices`,
  );
  return { monthly, monthsFound };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function historyTtl(monthsFound: number): number {
  return monthsFound >= 48 ? HISTORY_CACHE_MS : PARTIAL_HISTORY_CACHE_MS;
}

async function readHistoryFromMongo(): Promise<{
  monthly: MonthlyHistory;
  monthsFound: number;
  fresh: boolean;
} | null> {
  if (!clientPromise) return null;

  try {
    const client = await withTimeout(clientPromise, MONGO_CONNECT_TIMEOUT_MS);
    if (!client) return null;

    const doc = await withTimeout(
      client
        .db(MONGO_DB)
        .collection<StoredHistory>(MONGO_COLLECTION)
        .findOne({ _id: MONGO_HISTORY_ID }),
      MONGO_QUERY_TIMEOUT_MS,
    );
    if (!doc || !doc.updatedAt) return null;

    const monthsFound =
      typeof doc.monthsFound === 'number' ? doc.monthsFound : 0;
    const age = Date.now() - new Date(doc.updatedAt).getTime();
    const monthly = new Map<string, MonthlyPe[]>(
      Object.entries(doc.monthly ?? {}),
    );

    return {
      monthly,
      monthsFound,
      fresh: age <= historyTtl(monthsFound),
    };
  } catch (error) {
    console.warn('[india-pe] history cache read failed:', error);
    return null;
  }
}

function writeHistoryToMongo(monthly: MonthlyHistory, monthsFound: number): void {
  if (!clientPromise) return;

  void (async () => {
    try {
      const client = await clientPromise;
      await client.db(MONGO_DB).collection<StoredHistory>(MONGO_COLLECTION).updateOne(
        { _id: MONGO_HISTORY_ID },
        {
          $set: {
            updatedAt: new Date(),
            monthsFound,
            monthly: Object.fromEntries(monthly),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      console.warn('[india-pe] history cache write failed:', error);
    }
  })();
}

/**
 * A partial refresh must not erase a good cached window. Merge by month so
 * whichever snapshot supplied a given month wins, then keep the last 60.
 */
function mergeMonthlyHistory(
  base: MonthlyHistory,
  update: MonthlyHistory,
): MonthlyHistory {
  const merged: MonthlyHistory = new Map();
  const keys = new Set([...base.keys(), ...update.keys()]);

  for (const key of keys) {
    const points = new Map<string, MonthlyPe>();
    for (const point of base.get(key) ?? []) points.set(monthKey(point), point);
    for (const point of update.get(key) ?? []) points.set(monthKey(point), point);
    merged.set(
      key,
      [...points.values()]
        .sort((a, b) => a.year - b.year || a.month - b.month)
        .slice(-HISTORY_MONTHS),
    );
  }

  return merged;
}

async function loadNseHistoryUncached(): Promise<{
  monthly: MonthlyHistory;
  monthsFound: number;
}> {
  const now = Date.now();
  if (historyCache && now < historyCache.expiresAt) {
    return { monthly: historyCache.monthly, monthsFound: historyCache.monthsFound };
  }

  const stored = await readHistoryFromMongo();
  if (stored?.fresh) {
    historyCache = {
      monthly: stored.monthly,
      monthsFound: stored.monthsFound,
      expiresAt: now + historyTtl(stored.monthsFound),
    };
    return { monthly: stored.monthly, monthsFound: stored.monthsFound };
  }

  let fetched: { monthly: MonthlyHistory; monthsFound: number } | null = null;
  try {
    fetched = await fetchNseMonthlyHistory();
  } catch (error) {
    console.warn('[india-pe] NSE archive history failed:', error);
  }

  if (fetched && fetched.monthsFound > 0) {
    const merged = stored
      ? mergeMonthlyHistory(stored.monthly, fetched.monthly)
      : fetched.monthly;
    const monthsFound = Math.max(fetched.monthsFound, stored?.monthsFound ?? 0);
    historyCache = {
      monthly: merged,
      monthsFound,
      // Retry sooner when the archive itself returned a partial window.
      expiresAt: Date.now() + historyTtl(fetched.monthsFound),
    };
    if (stored || fetched.monthsFound >= HISTORY_WRITE_MIN_MONTHS) {
      writeHistoryToMongo(merged, monthsFound);
    } else {
      console.warn(
        `[india-pe] keeping Mongo cache untouched after partial ${fetched.monthsFound}-month refresh`,
      );
    }
    return { monthly: merged, monthsFound };
  }

  if (stored) {
    historyCache = {
      monthly: stored.monthly,
      monthsFound: stored.monthsFound,
      expiresAt: now + PARTIAL_HISTORY_CACHE_MS,
    };
    return { monthly: stored.monthly, monthsFound: stored.monthsFound };
  }

  if (historyCache) {
    return { monthly: historyCache.monthly, monthsFound: historyCache.monthsFound };
  }

  return { monthly: new Map(), monthsFound: 0 };
}

/**
 * Collapse concurrent cold requests into one archive rebuild. Without this, two
 * users opening Research at the same moment would each scrape NSE.
 */
function loadNseHistory(): Promise<{
  monthly: MonthlyHistory;
  monthsFound: number;
}> {
  const now = Date.now();
  if (historyCache && now < historyCache.expiresAt) {
    return Promise.resolve({
      monthly: historyCache.monthly,
      monthsFound: historyCache.monthsFound,
    });
  }
  if (historyRefresh) return historyRefresh;

  historyRefresh = loadNseHistoryUncached().finally(() => {
    historyRefresh = null;
  });
  return historyRefresh;
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
      DOWNSTOX_TIMEOUT_MS,
      1,
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
    const now = new Date();
    const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    for (const row of Array.isArray(payload.data.monthly) ? payload.data.monthly : []) {
      const pe = positiveNumber(row?.pe);
      if (typeof row?.year === 'number' && typeof row?.month === 'number' && pe != null) {
        // Keep the same completed-month baseline as the NSE archive; the
        // current month-to-date is already represented by the live P/E.
        if (Date.UTC(row.year, row.month, 1) >= currentMonthStart) continue;
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

async function fetchDownstoxFallback(
  slugs: string[],
): Promise<Map<string, DownstoxSnapshot | null>> {
  const uniqueSlugs = [...new Set(slugs)];
  if (uniqueSlugs.length === 0) return new Map();

  const deadline = Date.now() + DOWNSTOX_FALLBACK_TIMEOUT_MS;
  const entries = await Promise.all(
    uniqueSlugs.map(async (slug) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return [slug, null] as const;
      return [slug, await withTimeout(fetchDownstox(slug), remaining)] as const;
    }),
  );
  return new Map(entries);
}

const NIFTY_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Nifty Indices expects DD-MMM-YYYY dates in India Standard Time. */
function niftyDate(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000);
  return `${pad2(ist.getUTCDate())}-${NIFTY_MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()}`;
}

function parseNiftyDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(value.trim());
  if (!match) return null;

  const monthName = match[2][0].toUpperCase() + match[2].slice(1).toLowerCase();
  const month = NIFTY_MONTHS.indexOf(monthName);
  if (month < 0) return null;

  return `${match[3]}-${pad2(month + 1)}-${pad2(Number(match[1]))}`;
}

/**
 * The endpoint returns a JSON array, but older deployments wrap it in `d`.
 * Rows are newest first; skip any leading row without a usable P/E.
 */
function parseNiftyCurrent(body: string): NiftyCurrentValue | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }

  let rows: unknown = parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'd' in parsed) {
    const raw = (parsed as { d?: unknown }).d;
    if (typeof raw === 'string') {
      try {
        rows = JSON.parse(raw);
      } catch {
        return null;
      }
    } else {
      rows = raw;
    }
  }
  if (!Array.isArray(rows)) return null;

  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as {
      pe?: unknown;
      pb?: unknown;
      divYield?: unknown;
      DATE?: unknown;
    };
    const pe = positiveNumber(row.pe);
    if (pe == null) continue;

    return {
      pe,
      pb: positiveNumber(row.pb),
      dividendYield: nonNegativeNumber(row.divYield),
      asOf: parseNiftyDate(row.DATE),
      fetchedAt: new Date().toISOString(),
    };
  }

  return null;
}

function isFreshCurrent(value: NiftyCurrentValue, now = Date.now()): boolean {
  const fetchedAt = Date.parse(value.fetchedAt);
  return (
    Number.isFinite(fetchedAt) &&
    fetchedAt <= now + 60_000 &&
    now - fetchedAt <= CURRENT_CACHE_MS
  );
}

function freshCurrentValues(values: NiftyCurrentMap): NiftyCurrentMap {
  const now = Date.now();
  const fresh: NiftyCurrentMap = new Map();
  for (const [key, value] of values) {
    if (isFreshCurrent(value, now)) fresh.set(key, value);
  }
  return fresh;
}

function currentCacheExpiry(values: NiftyCurrentMap): number {
  const now = Date.now();
  let expiresAt = now + CURRENT_CACHE_MS;
  for (const value of values.values()) {
    const fetchedAt = Date.parse(value.fetchedAt);
    if (Number.isFinite(fetchedAt)) {
      expiresAt = Math.min(expiresAt, fetchedAt + CURRENT_CACHE_MS);
    }
  }
  return expiresAt;
}

async function readCurrentFromMongo(): Promise<NiftyCurrentMap | null> {
  if (!clientPromise) return null;

  try {
    const client = await withTimeout(clientPromise, MONGO_CONNECT_TIMEOUT_MS);
    if (!client) return null;

    const doc = await withTimeout(
      client
        .db(MONGO_DB)
        .collection<StoredCurrent>(MONGO_COLLECTION)
        .findOne({ _id: MONGO_CURRENT_ID }),
      MONGO_QUERY_TIMEOUT_MS,
    );
    if (!doc?.values) return null;

    const values: NiftyCurrentMap = new Map();
    for (const [key, raw] of Object.entries(doc.values)) {
      if (!raw || typeof raw !== 'object') continue;
      const pe = positiveNumber(raw.pe);
      const fetchedAt =
        typeof raw.fetchedAt === 'string' && Number.isFinite(Date.parse(raw.fetchedAt))
          ? raw.fetchedAt
          : null;
      if (pe == null || !fetchedAt) continue;

      values.set(key, {
        pe,
        pb: positiveNumber(raw.pb),
        dividendYield: nonNegativeNumber(raw.dividendYield),
        asOf: typeof raw.asOf === 'string' ? raw.asOf : null,
        fetchedAt,
      });
    }

    return values.size > 0 ? values : null;
  } catch (error) {
    console.warn('[india-pe] current cache read failed:', error);
    return null;
  }
}

function writeCurrentToMongo(values: NiftyCurrentMap): void {
  if (!clientPromise) return;

  void (async () => {
    try {
      const client = await clientPromise;
      await client.db(MONGO_DB).collection<StoredCurrent>(MONGO_COLLECTION).updateOne(
        { _id: MONGO_CURRENT_ID },
        {
          $set: {
            updatedAt: new Date(),
            values: Object.fromEntries(values),
          },
        },
        { upsert: true },
      );
    } catch (error) {
      console.warn('[india-pe] current cache write failed:', error);
    }
  })();
}

/**
 * Current values change once per trading day, so a 24-hour cache avoids
 * repeating one Nifty Indices call per missing sector on every refresh.
 */
async function loadNiftyCurrentCache(): Promise<NiftyCurrentMap> {
  const now = Date.now();
  if (currentCache && now < currentCache.expiresAt) {
    return freshCurrentValues(currentCache.values);
  }

  const stored = await readCurrentFromMongo();
  const values = freshCurrentValues(stored ?? new Map());
  currentCache = {
    values,
    // An empty cache should retry within the hour rather than staying cold.
    expiresAt: values.size > 0 ? currentCacheExpiry(values) : now + PARTIAL_HISTORY_CACHE_MS,
  };
  return values;
}

async function fetchNiftyCurrentOne(
  config: IndexConfig,
  deadline: number,
): Promise<NiftyCurrentValue | null> {
  const remaining = deadline - Date.now();
  if (remaining < 1_000) return null;

  const now = new Date();
  const from = new Date(now.getTime() - 10 * 24 * 60 * 60_000);
  const tradingName = (config.niftyName ?? config.name).toUpperCase();
  const cinfo = `{'name':'${tradingName}','startDate':'${niftyDate(
    from,
  )}','endDate':'${niftyDate(now)}','indexName':'${config.name}'}`;

  try {
    const response = await httpsPostJson(
      NIFTY_INDICES_URL,
      {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: 'https://www.niftyindices.com/reports/historical-data',
        'User-Agent': NIFTY_INDICES_USER_AGENT,
      },
      JSON.stringify({ cinfo }),
      Math.min(NIFTY_INDICES_TIMEOUT_MS, remaining),
    );
    if (response.status !== 200) {
      throw new Error(`Nifty Indices responded with ${response.status}`);
    }

    const value = parseNiftyCurrent(response.body);
    if (!value) throw new Error('Nifty Indices returned no usable P/E rows');
    return value;
  } catch (error) {
    console.warn(`[india-pe] Nifty Indices ${config.name} failed:`, error);
    return null;
  }
}

async function fetchNiftyCurrentMissing(
  configs: IndexConfig[],
  existing: NiftyCurrentMap,
  deadline: number,
): Promise<NiftyCurrentMap> {
  if (configs.length === 0) return existing;

  console.log(
    `[india-pe] using Nifty Indices fallback for ${configs.length} missing current value(s)`,
  );
  const fetched = await mapWithConcurrency(
    configs,
    NIFTY_INDICES_CONCURRENCY,
    async (config) => [config.key, await fetchNiftyCurrentOne(config, deadline)] as const,
  );

  const values = new Map(existing);
  let added = 0;
  for (const [key, value] of fetched) {
    if (!value) continue;
    values.set(key, value);
    added += 1;
  }

  console.log(
    `[india-pe] Nifty Indices supplied ${added}/${configs.length} current value(s)`,
  );
  if (added > 0) {
    currentCache = { values, expiresAt: currentCacheExpiry(values) };
    writeCurrentToMongo(values);
  }
  return values;
}

function fallbackSlugsNeeded(
  nse: NseSnapshot | null,
  monthly: MonthlyHistory,
): string[] {
  const slugs = new Set<string>();

  for (const config of INDEX_CONFIG) {
    if (!config.downstoxSlug) continue;
    const key = normalizeIndexName(config.nseName);
    const needsCurrent = nse?.rows.get(key)?.pe == null;
    const points = monthly.get(key);
    const needsHistory = !points || points.length < MIN_HISTORY_MONTHS;
    if (needsCurrent || needsHistory) slugs.add(config.downstoxSlug);
  }

  return [...slugs];
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
  monthly: MonthlyPe[] | undefined,
  currentPe: number | null,
): IndexHistory | null {
  if (!monthly || monthly.length === 0) return null;

  const window = monthly.slice(-HISTORY_MONTHS);
  if (window.length < MIN_HISTORY_MONTHS) return null;

  const values = window.map((row) => row.pe).sort((a, b) => a - b);
  const reference =
    currentPe ?? window[window.length - 1]?.pe ?? null;
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
  monthly: MonthlyHistory,
  fallback: Map<string, DownstoxSnapshot | null>,
  niftyCurrent: NiftyCurrentMap,
): IndiaPeData {
  const used = new Set<ValuationSource>();

  const indices = INDEX_CONFIG.map((config): IndexValuation => {
    const key = normalizeIndexName(config.nseName);
    const nseRow = nse?.rows.get(key) ?? null;
    const downstox = config.downstoxSlug
      ? fallback.get(config.downstoxSlug) ?? null
      : null;
    const nifty = niftyCurrent.get(config.key) ?? null;

    const pe = nseRow?.pe ?? downstox?.currentPe ?? nifty?.pe ?? null;
    const pb = nseRow?.pb ?? downstox?.currentPb ?? nifty?.pb ?? null;
    const dividendYield =
      nseRow?.dividendYield ?? downstox?.currentDividendYield ?? nifty?.dividendYield ?? null;

    const currentSource: ValuationSource | null =
      nseRow?.pe != null
        ? 'nse'
        : downstox?.currentPe != null
          ? 'downstox'
          : nifty?.pe != null
            ? 'nifty-indices'
            : null;
    if (currentSource) used.add(currentSource);

    const nseHistory = buildHistory(monthly.get(key), pe);
    const downstoxHistory = buildHistory(downstox?.monthly, pe);
    const history = nseHistory ?? downstoxHistory;

    return {
      key: config.key,
      name: config.name,
      category: config.category,
      featured: config.featured,
      pe,
      pb,
      dividendYield,
      earningsYield: pe != null && pe > 0 ? 100 / pe : null,
      history,
      historySource: nseHistory ? 'nse' : downstoxHistory ? 'downstox' : null,
      currentSource,
    };
  });

  const sources = [...used];
  const source =
    sources.length === 0 ? null : sources.length === 1 ? sources[0] : 'mixed';
  const asOf =
    nse?.asOf ??
    [...fallback.values()].find((snapshot) => snapshot?.asOf)?.asOf ??
    [...niftyCurrent.values()].find((value) => value.asOf)?.asOf ??
    null;

  return { asOf, source, sources, stale: false, indices };
}

function cacheHeadersFor(ttlMs: number): Record<string, string> {
  const seconds = Math.ceil(ttlMs / 1000);
  return {
    'Cache-Control': `public, s-maxage=${seconds}, stale-while-revalidate=${Math.floor(seconds / 2)}`,
  };
}

/** Retry sooner while a current quote is missing; history has its own 24h cache. */
function cacheTtlFor(data: IndiaPeData): number {
  return data.indices.some((index) => index.pe == null) ? SHORT_CACHE_MS : CACHE_MS;
}

export async function GET() {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return NextResponse.json(
      { success: true, data: cache.data },
      { headers: cacheHeadersFor(cache.expiresAt - now) },
    );
  }

  const [nse, historyState, cachedCurrent] = await Promise.all([
    fetchNseSnapshot(),
    loadNseHistory(),
    loadNiftyCurrentCache(),
  ]);

  const nsePeFor = (config: IndexConfig): number | null =>
    nse?.rows.get(normalizeIndexName(config.nseName))?.pe ?? null;

  /**
   * Start Nifty Indices alongside Downstox for sectors Downstox does not cover.
   * This keeps a cold response within the mobile client's 45-second budget when
   * NSE is blocked. Values from Downstox still take precedence because the
   * second wave below only fills whatever is left.
   */
  const niftyDeadline = Date.now() + NIFTY_INDICES_TOTAL_TIMEOUT_MS;
  const niftyFirstWave = INDEX_CONFIG.filter(
    (config) =>
      nsePeFor(config) == null &&
      !cachedCurrent.has(config.key) &&
      config.downstoxSlug == null,
  );
  const niftyPromise = fetchNiftyCurrentMissing(
    niftyFirstWave,
    cachedCurrent,
    niftyDeadline,
  );

  const fallbackSlugs = fallbackSlugsNeeded(nse, historyState.monthly);
  if (fallbackSlugs.length > 0) {
    console.log(
      `[india-pe] using Downstox fallback for ${fallbackSlugs.length} index slug(s)`,
    );
  }
  const fallback = await fetchDownstoxFallback(fallbackSlugs);
  let niftyCurrent = await niftyPromise;

  const attemptedNifty = new Set(niftyFirstWave.map((config) => config.key));
  const niftySecondWave = INDEX_CONFIG.filter((config) => {
    if (nsePeFor(config) != null) return false;
    if (niftyCurrent.has(config.key)) return false;
    if (attemptedNifty.has(config.key)) return false;
    if (config.downstoxSlug) {
      return fallback.get(config.downstoxSlug)?.currentPe == null;
    }
    return true;
  });
  if (niftySecondWave.length > 0) {
    niftyCurrent = await fetchNiftyCurrentMissing(
      niftySecondWave,
      niftyCurrent,
      Date.now() + NIFTY_INDICES_SECOND_WAVE_TIMEOUT_MS,
    );
  }

  const data = buildData(nse, historyState.monthly, fallback, niftyCurrent);

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
