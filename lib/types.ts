export type Asset = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  entryPrice: number;
  manualPrice?: number;
  manualSector?: string;
  purchaseDate?: string;
  /** Last quote returned by an exchange integration (USD unless currency says otherwise). */
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
  regularMarketPrice: number;
  currency: string;
  shortName: string;
  marketCap?: number;
  /** Authoritative Indian cap bucket when the quote source publishes one. */
  capCategory?: 'Large Cap' | 'Mid Cap' | 'Small Cap' | null;
  quoteType?: string;
  sector?: string;
  source?: string;
  /** When the client fetched the quote. Prefer `asOf` for quote freshness. */
  lastUpdated: number;
  /** The provider's own quote/NAV timestamp, in epoch milliseconds. */
  asOf?: number | null;
  /** True when the value came from a cache/fallback rather than a live quote. */
  stale?: boolean;
};

export type ChatMessage = {
  role: string;
  content: string | null;
  thought?: string;
  thoughtSignature?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  model?: string;
  isFallback?: boolean;
};
