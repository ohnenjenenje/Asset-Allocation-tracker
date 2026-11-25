import type { FundConstituent, FundSlice } from './analytics';
import type { Holding } from './aggregate';
import { isFundAsset, normalizeGroup } from './normalize';

/**
 * Single-stock concentration is measured against the Equities sleeve, not the
 * total portfolio. The sleeve already contains equity exposure from funds and
 * other equity assets, so it is the right denominator for a stock-level cap.
 *
 * Direct stock lots and fund look-through are merged into one exposure line per
 * stock. Each row also retains the funds that contribute to it, so the UI can
 * show which scheme to trim. Fund look-through is best-effort: only disclosed
 * holdings contribute, and the report carries coverage so the UI can warn about
 * the blind spot.
 */
export const DEFAULT_STOCK_CONCENTRATION_LIMIT = 10;

/** A row enters watch one percentage point below the hard cap. */
export const STOCK_CONCENTRATION_WATCH_BAND_PCT = 1;

export type StockConcentrationStatus = 'ok' | 'watch' | 'breach';

/** A fund's look-through contribution to one stock row. */
export interface StockConcentrationFund {
  key: string;
  name: string;
  /** Value of this stock held inside the fund, in paise. */
  value: number;
  /** Total value of the fund, in paise, used to show the stock's fund weight. */
  fundValue: number;
  /** Fund asset to open from the card, when one exists. */
  assetId?: string;
}

export interface StockConcentrationRow {
  key: string;
  name: string;
  symbol?: string;
  /** Direct stock lots, in paise. */
  directValue: number;
  /** Look-through stock value held inside funds/ETFs, in paise. */
  fundValue: number;
  /** directValue + fundValue, in paise. */
  totalValue: number;
  /** Share of the Equities sleeve, 0..100+. */
  equityPercentage: number;
  /** Share of the total portfolio, 0..100+, when a portfolio value is known. */
  portfolioPercentage: number;
  status: StockConcentrationStatus;
  /** Direct asset to open from the card, when one exists. */
  assetId?: string;
  /** Fund-level contributions to this stock, largest first. */
  funds: StockConcentrationFund[];
}

export interface StockConcentrationCoverage {
  /** Equity funds with at least one disclosed holding. */
  withData: number;
  /** Equity funds with a positive value. */
  total: number;
  /** Disclosed stock value contributed by funds, in paise. */
  coveredValue: number;
  /** Total value of the equity funds, in paise. */
  fundValue: number;
}

export interface StockConcentrationReport {
  rows: StockConcentrationRow[];
  /** Equities sleeve value used as the denominator, in paise. */
  equityValue: number;
  portfolioValue: number;
  /** Direct stock value across every row, in paise. */
  directValue: number;
  /** Disclosed fund look-through value across every row, in paise. */
  fundValue: number;
  /** Equity sleeve value not attributed to a disclosed single stock, in paise. */
  otherEquityValue: number;
  limitPct: number;
  breachCount: number;
  watchCount: number;
  largest: StockConcentrationRow | null;
  coverage: StockConcentrationCoverage;
}

export interface StockConcentrationInput {
  /** Individual lots, usually `summary.holdings`. */
  holdings: Holding[];
  /** Look-through data, usually `analytics.funds`. */
  funds: FundSlice[];
  /** Equities sleeve value in paise. */
  equityValue: number;
  /** Total portfolio value in paise, used only for context. */
  portfolioValue?: number;
  limitPct?: number;
}

type SourceKind = 'direct' | 'fund';

interface StockSource {
  aliases: string[];
  name: string;
  symbol?: string;
  value: number;
  kind: SourceKind;
  assetId?: string;
  /** Fund identity for fund look-through sources. */
  fundKey?: string;
  fundName?: string;
  fundValue?: number;
}

interface RowBuilder {
  directValue: number;
  fundValue: number;
  directName?: string;
  fundName?: string;
  symbol?: string;
  assetId?: string;
  funds: Map<string, StockConcentrationFund>;
}

const RESIDUAL_NAMES = new Set([
  'other',
  'others',
  'other assets',
  'other liabilities',
  'other income',
  'cash',
  'cash and equivalents',
  'cash equivalents',
  'cash and cash equivalents',
  'money market',
  'money market instruments',
  'net receivables',
  'net current assets',
  'receivables',
  'treasury',
  'treasury bills',
  'government securities',
  'sovereign securities',
  'bond',
  'bonds',
  'corporate bonds',
  'debenture',
  'debentures',
  'debt',
  'deposit',
  'deposits',
  'repo',
  'repos',
  'reverse repo',
  'derivative',
  'derivatives',
  'future',
  'futures',
  'option',
  'options',
  'swap',
  'swaps',
  'mutual fund',
  'mutual funds',
  'mutual fund units',
  'exchange traded fund',
  'exchange traded funds',
  'etf',
  'etfs',
  'fund',
  'unclassified',
  'unknown',
  'total',
]);

const EXCHANGE_SUFFIX = /\.(NS|BO|NSE|BSE|L|TO|AX|HK|T|SI|KS|TW|DE|PA|AS|SW|MI|MC|ST|OL|CO|HE|VI|IR|F|US)$/i;
const EXCHANGE_PREFIX = /^(NSE|BSE|NASDAQ|NYSE|AMEX):/i;

/**
 * Stock symbols appear with exchange suffixes (`HDFCBANK.NS`) in quotes and
 * without them in fund holdings. Strip only known exchange markers so class
 * shares such as `BRK-B` stay distinct.
 */
export function stockSymbolBase(symbol?: string): string {
  if (!symbol) return '';
  const raw = symbol.trim().toUpperCase();
  if (!raw) return '';
  return raw.replace(EXCHANGE_PREFIX, '').replace(EXCHANGE_SUFFIX, '');
}

/**
 * Normalize a company name for cross-source matching. Legal suffixes,
 * punctuation and ampersands are removed so "HDFC Bank Ltd." and
 * "HDFC Bank" converge without merging unrelated companies.
 */
export function normalizeStockName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(ltd|limited|inc|incorporated|corp|corporation|plc|co|company|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function aliasesFor(name: string, symbol?: string): string[] {
  const aliases: string[] = [];
  const base = stockSymbolBase(symbol);
  if (base.length >= 2) aliases.push(`sym:${base}`);
  const normalized = normalizeStockName(name);
  if (normalized) aliases.push(`name:${normalized}`);
  return aliases;
}

function isDirectStock(asset: Holding['asset']): boolean {
  const type = (asset.type || '').toUpperCase();
  if (type !== 'EQUITY' && type !== 'STOCK') return false;
  if (asset.isGroup) return false;
  if (isFundAsset(asset)) return false;
  // Some providers type an index fund or ETF as a stock. Wrapper names are
  // never single-stock exposure.
  return !/\b(fund|funds|etf|etfs|bees)\b/.test(asset.name.toLowerCase());
}

function isResidualHolding(name: string): boolean {
  const normalized = normalizeStockName(name);
  if (!normalized) return true;
  if (RESIDUAL_NAMES.has(normalized)) return true;
  if (normalized.startsWith('other ')) return true;
  // Fund-of-funds and ETF look-through sometimes leaks a wrapper name into the
  // holdings list. Those are not single-stock exposure.
  return /\b(etf|etfs|bees|fund|funds)\b/.test(normalized);
}

function stockPositionFor(constituent: FundConstituent): number | null {
  const allocation = constituent.assetAllocation;
  if (!allocation) return null;
  const value = Number(allocation.stockPosition);
  return Number.isFinite(value) ? value : null;
}

function shorterName(current?: string, candidate?: string): string | undefined {
  if (!current) return candidate;
  if (!candidate) return current;
  return candidate.length < current.length ? candidate : current;
}

export function stockConcentrationStatus(
  percentage: number,
  limitPct: number = DEFAULT_STOCK_CONCENTRATION_LIMIT,
): StockConcentrationStatus {
  if (!Number.isFinite(percentage)) return 'ok';
  if (percentage > limitPct) return 'breach';
  if (percentage >= limitPct - STOCK_CONCENTRATION_WATCH_BAND_PCT) return 'watch';
  return 'ok';
}

/**
 * Resolve the Equities sleeve value. Falls back to the analytics equity total
 * when policy sleeves are unavailable, so the cap still works before a policy
 * is confirmed.
 */
export function equitySleeveValue(
  sleeves: { path: string; label?: string; currentValue: number }[] | undefined,
  fallback: number,
): number {
  const equity = sleeves?.find((sleeve) => {
    const root = normalizeGroup((sleeve.path || '').split(' > ')[0]);
    if (root === 'Equities') return true;
    return normalizeGroup(sleeve.label ?? '') === 'Equities';
  });
  const value = Number(equity?.currentValue);
  if (Number.isFinite(value) && value > 0) return value;

  const fallbackValue = Number(fallback);
  return Number.isFinite(fallbackValue) && fallbackValue > 0 ? fallbackValue : 0;
}

export function analyzeStockConcentration(
  input: StockConcentrationInput,
): StockConcentrationReport {
  const limitPct =
    Number.isFinite(input.limitPct) && (input.limitPct ?? 0) > 0
      ? (input.limitPct as number)
      : DEFAULT_STOCK_CONCENTRATION_LIMIT;
  const equityValue =
    Number.isFinite(input.equityValue) && input.equityValue > 0
      ? input.equityValue
      : 0;
  const portfolioValue =
    Number.isFinite(input.portfolioValue) && (input.portfolioValue ?? 0) > 0
      ? (input.portfolioValue as number)
      : 0;

  const sources: StockSource[] = [];

  for (const holding of input.holdings) {
    if (!isDirectStock(holding.asset)) continue;
    if (!(holding.currentValue > 0)) continue;
    sources.push({
      aliases: aliasesFor(holding.asset.name, holding.asset.symbol),
      name: holding.asset.name,
      symbol: holding.asset.symbol,
      value: holding.currentValue,
      kind: 'direct',
      assetId: holding.asset.id,
    });
  }

  let equityFunds = 0;
  let equityFundsWithData = 0;
  let equityFundValue = 0;

  for (const fund of input.funds) {
    let fundIsEquity = false;
    let fundHasDisclosure = false;

    for (const constituent of fund.constituents ?? []) {
      const stockPosition = stockPositionFor(constituent);
      // A debt-only scheme cannot contribute stock exposure.
      if (stockPosition != null && stockPosition <= 0) continue;

      fundIsEquity = true;
      const subHoldings = constituent.subHoldings ?? [];
      if (subHoldings.length > 0) fundHasDisclosure = true;

      for (const holding of subHoldings) {
        if (!(holding.value > 0)) continue;
        if (isResidualHolding(holding.name)) continue;
        sources.push({
          aliases: aliasesFor(holding.name, holding.symbol),
          name: holding.name,
          symbol: holding.symbol,
          value: holding.value,
          kind: 'fund',
          fundKey: fund.key,
          fundName: fund.name,
          fundValue: fund.value,
          assetId: constituent.assetId,
        });
      }
    }

    if (fundIsEquity && fund.value > 0) {
      equityFunds += 1;
      equityFundValue += fund.value;
      if (fundHasDisclosure) equityFundsWithData += 1;
    }
  }

  // Union-find over alias collisions. A fund may disclose a symbol while a
  // direct lot or another fund only carries the company name; the shared alias
  // bridges them into one exposure line.
  const parents = sources.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    let cursor = index;
    while (parents[cursor] !== cursor) {
      const next = parents[cursor];
      parents[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (a: number, b: number) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parents[rootB] = rootA;
  };

  const aliasOwner = new Map<string, number>();
  sources.forEach((source, index) => {
    for (const alias of source.aliases) {
      const owner = aliasOwner.get(alias);
      if (owner === undefined) aliasOwner.set(alias, index);
      else union(owner, index);
    }
  });

  const builders = new Map<number, RowBuilder>();
  sources.forEach((source, index) => {
    const root = find(index);
    const builder = builders.get(root) ?? {
      directValue: 0,
      fundValue: 0,
      funds: new Map<string, StockConcentrationFund>(),
    };
    builders.set(root, builder);

    if (source.kind === 'direct') {
      builder.directValue += source.value;
      builder.assetId = builder.assetId ?? source.assetId;
      builder.directName = shorterName(builder.directName, source.name);
    } else {
      builder.fundValue += source.value;
      builder.fundName = shorterName(builder.fundName, source.name);
      if (source.fundKey && source.fundName) {
        const existing = builder.funds.get(source.fundKey);
        if (existing) {
          existing.value += source.value;
          existing.fundValue = Math.max(existing.fundValue, source.fundValue ?? 0);
          existing.assetId = existing.assetId ?? source.assetId;
        } else {
          builder.funds.set(source.fundKey, {
            key: source.fundKey,
            name: source.fundName,
            value: source.value,
            fundValue: source.fundValue ?? 0,
            assetId: source.assetId,
          });
        }
      }
    }
    builder.symbol = builder.symbol ?? source.symbol;
  });

  const rows: StockConcentrationRow[] = [...builders.values()]
    .map((builder) => {
      const totalValue = builder.directValue + builder.fundValue;
      const name = builder.directName ?? builder.fundName ?? 'Unnamed stock';
      const symbol = builder.symbol;
      const base = stockSymbolBase(symbol);
      const key = base
        ? `stock:${base}`
        : `name:${normalizeStockName(name)}`;
      const equityPercentage =
        equityValue > 0 ? (totalValue / equityValue) * 100 : 0;
      const funds = [...builder.funds.values()]
        .filter((fund) => fund.value > 0)
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
      return {
        key,
        name,
        symbol,
        directValue: builder.directValue,
        fundValue: builder.fundValue,
        totalValue,
        equityPercentage,
        portfolioPercentage:
          portfolioValue > 0 ? (totalValue / portfolioValue) * 100 : 0,
        status: stockConcentrationStatus(equityPercentage, limitPct),
        assetId: builder.assetId,
        funds,
      };
    })
    .filter((row) => row.totalValue > 0)
    .sort(
      (a, b) =>
        b.totalValue - a.totalValue ||
        b.equityPercentage - a.equityPercentage ||
        a.name.localeCompare(b.name),
    );

  const directValue = rows.reduce((sum, row) => sum + row.directValue, 0);
  const fundValue = rows.reduce((sum, row) => sum + row.fundValue, 0);
  const otherEquityValue = Math.max(0, equityValue - directValue - fundValue);

  return {
    rows,
    equityValue,
    portfolioValue,
    directValue,
    fundValue,
    otherEquityValue,
    limitPct,
    breachCount: rows.filter((row) => row.status === 'breach').length,
    watchCount: rows.filter((row) => row.status === 'watch').length,
    largest: rows[0] ?? null,
    coverage: {
      withData: equityFundsWithData,
      total: equityFunds,
      coveredValue: fundValue,
      fundValue: equityFundValue,
    },
  };
}
