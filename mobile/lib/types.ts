export type BaseAsset = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  entryPrice: number;
  manualPrice?: number;
  manualSector?: string;
  purchaseDate?: string;
  currency: string;
  type: string;
  categoryPath?: string[];
  exchange?: string;
};

export type GroupAsset = BaseAsset & {
  isGroup: true;
  subItems: Asset[];
};

export type LeafAsset = BaseAsset & {
  isGroup?: false;
  subItems?: never;
};

export type Asset = GroupAsset | LeafAsset;

// LSP: shared contract for exchange assets (Binance / CoinDCX now substitutable)
export type ExchangeAsset = {
  symbol: string; // e.g., BTC/USDT
  name: string;
  quantity: number;
  type: 'CRYPTO';
  currentPrice: number;
  priceCurrency: 'USD' | 'INR';
  exchange: 'Binance' | 'CoinDCX';
  id?: string;
  entryPrice?: number;
  currency?: string;
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

export type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: string;
  content: string | null;
  thought?: string;
  thoughtSignature?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  model?: string;
  isFallback?: boolean;
};

// ISP: narrow views for usePortfolioData consumers
export type PortfolioAssetsView = {
  assets: Asset[];
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
  fundHoldings: Record<string, any>;
  setFundHoldings: React.Dispatch<React.SetStateAction<Record<string, any>>>;
};

export type PortfolioSettingsView = {
  idealAllocation: Record<string, number>;
  setIdealAllocation: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  aiProvider: 'openrouter' | 'google';
  setAiProvider: React.Dispatch<React.SetStateAction<'openrouter' | 'google'>>;
  searchSource: string;
  setSearchSource: React.Dispatch<React.SetStateAction<any>>;
};
