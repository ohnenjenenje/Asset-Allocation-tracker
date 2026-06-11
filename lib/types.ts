export type Asset = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  entryPrice: number;
  manualPrice?: number;
  manualSector?: string;
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
  quoteType?: string;
  sector?: string;
  source?: string;
  lastUpdated: number;
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
