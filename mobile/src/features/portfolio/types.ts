/**
 * Domain types. Kept structurally compatible with the web app's `lib/types.ts`
 * so the same MongoDB documents can be consumed without a translation layer.
 */
export type Asset = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  entryPrice: number;
  manualPrice?: number;
  manualSector?: string;
  /** Manual classification overrides, used before provider or inferred data. */
  manualCap?: string;
  manualLiquidity?: LiquidityTier;
  /** Household account this holding belongs to. Defaults to the primary account. */
  account?: string;
  purchaseDate?: string;
  /** Last quote returned by an exchange integration. */
  currentPrice?: number;
  currency: string;
  type: string;
  categoryPath?: string[];
  exchange?: string;
  isGroup?: boolean;
  subItems?: Asset[];
};

export type PriceData = {
  symbol: string;
  regularMarketPrice: number | null;
  currency: string;
  shortName: string;
  marketCap?: number | null;
  quoteType?: string | null;
  sector?: string | null;
  source?: string | null;
  /** When the client fetched the quote. Prefer `asOf` for quote freshness. */
  lastUpdated?: number;
  /** The provider's own quote/NAV timestamp, in epoch milliseconds. */
  asOf?: number | null;
  /** True when the value came from a cache/fallback rather than a live quote. */
  stale?: boolean;
};

export type PolicySource = 'template' | 'custom' | 'migrated';
export type PolicyReviewCadence = 'quarterly' | 'semiannual' | 'annual';
export type PolicyRebalanceMethod = 'threshold' | 'calendar' | 'hybrid';

/**
 * Institutional decision levels. Roots are always policy nodes. Composition
 * nodes explain how a sleeve is built; promoted nodes become monitored or
 * actionable policy nodes with their own explicit ranges.
 */
export type PolicyDecisionLevel = 'policy' | 'monitor' | 'composition';

/** Allowed range as a percentage of the total portfolio. */
export type PolicyRange = {
  min: number;
  max: number;
};

export type LiquidityTier = 'Daily' | 'Weekly' | 'Monthly' | 'Illiquid';

export type PolicyRebalance = {
  method: PolicyRebalanceMethod;
  cashFlowFirst: boolean;
  minCashPct: number;
};

/** Transparent, assumption-based risk model used for risk budgeting. */
export type PolicyRiskModel = {
  /** Annualised expected volatility in percent, keyed by sleeve path. */
  volatility: Record<string, number>;
  /** Default pairwise correlation for sleeves without an explicit pair. */
  correlation: number;
  /** Optional pairwise correlation overrides, keyed by `a|b`. */
  correlations?: Record<string, number>;
};

export type PolicyCurrencyConfig = {
  baseCurrency: 'INR';
  /** Target hedged share (percent) by currency. Unlisted currencies stay unhedged. */
  hedgeTargets?: Record<string, number>;
};

export type PolicyLiquidityConfig = {
  /** Minimum share of the portfolio that must remain daily or weekly liquid. */
  minLiquidPct: number;
};

/**
 * A versioned allocation policy. `targets` mirrors the web's
 * `settings.idealAllocation` shape: root paths are percentages of the whole
 * portfolio, while child paths are percentages of their parent. Bands apply to
 * root sleeves and are expressed in percentage points.
 */
export type Policy = {
  id: string;
  version: number;
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
  baseCurrency: 'INR';
  targets: Record<string, number>;
  bands: Record<string, number>;
  rebalance: PolicyRebalance;
  reviewCadence: PolicyReviewCadence;
  confirmedAt: string | null;
  source: PolicySource;
  /** Explicit policy ranges as % of total. Roots fall back to target ± band. */
  ranges?: Record<string, PolicyRange>;
  /** Overrides for non-root nodes. Unlisted children are composition nodes. */
  decisionLevels?: Record<string, PolicyDecisionLevel>;
  /** Optional benchmark label per policy node. */
  benchmarks?: Record<string, string>;
  /** Carry an explicit Unallocated remainder instead of requiring 100%. */
  allowUnallocated?: boolean;
  /** Separate sector/industry policy, expressed as % of equity exposure. */
  sectorTargets?: Record<string, number>;
  sectorRanges?: Record<string, PolicyRange>;
  /** Target share of total portfolio risk, in percent, by sleeve path. */
  riskBudget?: Record<string, number>;
  riskModel?: PolicyRiskModel;
  currencyPolicy?: PolicyCurrencyConfig;
  liquidityPolicy?: PolicyLiquidityConfig;
  notes?: string;
  approvedBy?: string;
  changeNote?: string;
};

export type FundHolding = {
  symbol: string;
  holdingName: string;
  /** Fraction (0.08) or percentage (8) depending on the provider. */
  holdingPercent: number;
};

export type FundSectorWeighting = {
  sector: string;
  percentage: number;
};

export type FundAssetAllocation = {
  stockPosition: number;
  bondPosition: number;
  cashPosition: number;
  otherPosition: number;
  preferredPosition: number;
  convertiblePosition: number;
};

export type FundMarketCapWeightage = {
  largeCap: number;
  midCap: number;
  smallCap: number;
  others: number;
};

/** Look-through data returned by `/api/holdings` (and cached on the user doc). */
export type FundData = {
  symbol?: string;
  source?: string | null;
  /** When the look-through composition was last refreshed. */
  lastUpdated?: number;
  categoryName?: string | null;
  holdings?: FundHolding[];
  sectorWeightings?: FundSectorWeighting[];
  assetAllocation?: FundAssetAllocation | null;
  marketCapWeightage?: FundMarketCapWeightage | null;
  /** `tracked-index` for ETF index look-through, `proxy-fund` for same-index funds. */
  lookthrough?: string | null;
  note?: string | null;
  debug?: string;
};

export type PortfolioSnapshot = {
  uid?: string;
  email?: string;
  displayName?: string;
  assets?: Asset[];
  fundHoldings?: Record<string, FundData>;
  idealAllocation?: Record<string, number>;
  policy?: Policy;
  policyHistory?: Policy[];
  settings?: {
    idealAllocation?: Record<string, number>;
    [key: string]: unknown;
  };
  /** Exchange balance cache written by the web dashboard. */
  cachedCrypto?: Record<
    string,
    {
      lastSynced?: number;
      assets?: Asset[];
    }
  >;
  updatedAt?: string;
};

export type SyncResponse = {
  success: boolean;
  data: PortfolioSnapshot;
};

export type ScreenerStock = {
  sid: string;
  ticker: string;
  name: string;
  sector?: string;
  /** Market cap in millions of INR, exactly as the screener reports it. */
  marketCap?: number;
  peRatio?: number;
  pbRatio?: number;
  divYield?: number;
  price?: number;
  change?: number;
  pchange?: number;
};

export type ScreenerFilter = {
  id: string;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'between';
  val: number | [number, number];
};

export type ScreenerFilters = {
  filters: ScreenerFilter[];
  sort: string;
  order: 1 | -1;
  limit: number;
};
