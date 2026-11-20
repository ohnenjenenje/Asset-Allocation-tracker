import { apiFetch } from '@/src/lib/api/client';

import type { PortfolioSummary } from '../portfolio/aggregate';
import type { PortfolioAnalytics } from '../portfolio/analytics';
import { fetchFundData, fetchPrices } from '../portfolio/api';
import type { FundData, PriceData } from '../portfolio/types';

export interface AssistantContext {
  summary: PortfolioSummary;
  analytics: PortfolioAnalytics;
  prices: Record<string, PriceData>;
  fundHoldings: Record<string, FundData>;
}

export const TOOL_LABELS: Record<string, string> = {
  get_portfolio_summary: 'Reading your portfolio',
  get_exposure_summary: 'Calculating your exposure',
  search_asset: 'Searching the market',
  get_quote: 'Fetching the latest price',
  get_fund_holdings: 'Looking inside the fund',
};

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round((Number.isFinite(value) ? value : 0) * factor) / factor;
};

const percentOf = (value: number, total: number): number =>
  total > 0 ? round((value / total) * 100) : 0;

// Mobile aggregates store money in paise; the model works in rupees.
const rupees = (paise: number): number => Math.round(paise / 100);

function portfolioSummary(context: AssistantContext) {
  const { summary } = context;
  return {
    totalValue: rupees(summary.currentValue),
    investedValue: rupees(summary.investedValue),
    profitLoss: rupees(summary.pnl),
    profitLossPercent: round(summary.pnlPercent),
    assetCount: summary.assetCount,
    allocation: summary.allocation.map((slice) => ({
      category: slice.label,
      value: rupees(slice.value),
      percent: round(slice.percent),
    })),
    holdings: summary.holdings.slice(0, 60).map((holding) => ({
      symbol: holding.asset.symbol,
      name: holding.asset.name,
      type: holding.category,
      value: rupees(holding.currentValue),
      weightPercent: percentOf(holding.currentValue, summary.currentValue),
      pnlPercent: round(holding.pnlPercent),
      livePrice: holding.hasLivePrice,
    })),
  };
}

function exposureSummary(context: AssistantContext) {
  const { analytics } = context;
  const total = analytics.totals.portfolio;
  return {
    totalPortfolioValue: rupees(total),
    equityValue: rupees(analytics.totals.equity),
    fundValue: rupees(analytics.totals.fund),
    fundCoverage: analytics.fundCoverage,
    sectors: analytics.sectors.slice(0, 15).map((sector) => ({
      sector: sector.name,
      value: rupees(sector.value),
      percentOfPortfolio: percentOf(sector.value, total),
    })),
    marketCap: analytics.marketCap.map((bucket) => ({
      bucket: bucket.name,
      value: rupees(bucket.value),
      percentOfPortfolio: percentOf(bucket.value, total),
    })),
    topUnderlying: analytics.underlying.slice(0, 15).map((item) => ({
      symbol: item.symbol,
      name: item.name,
      value: rupees(item.value),
      type: item.type,
    })),
  };
}

async function searchAsset(query: string, token?: string | null) {
  const search = new URLSearchParams({ q: query, source: 'yahoo' });
  const results = await apiFetch<any[]>(`/api/search?${search.toString()}`, {
    token,
    timeoutMs: 30_000,
  });

  return (Array.isArray(results) ? results : []).slice(0, 6).map((item) => ({
    symbol: item.symbol,
    name: item.longname || item.shortname || item.symbol,
    type: item.quoteType || 'UNKNOWN',
    source: item.source || 'Yahoo Finance',
  }));
}

async function quote(symbol: string, token?: string | null) {
  // Reads are live by default and never write to the sheet; `sync=true` is the
  // only mutating mode, and the assistant never asks for it.
  const quotes = await fetchPrices([symbol], { token });
  const quoteData = quotes[symbol];
  if (!quoteData) {
    return { error: `No live quote found for ${symbol}. Check the ticker and try again.` };
  }
  return {
    symbol: quoteData.symbol,
    price: quoteData.regularMarketPrice,
    currency: quoteData.currency,
    name: quoteData.shortName,
    source: quoteData.source,
    asOf: quoteData.asOf ?? null,
    stale: Boolean(quoteData.stale),
    lastUpdated: quoteData.lastUpdated,
  };
}

async function fundHoldings(
  symbol: string,
  name: string | undefined,
  token?: string | null,
) {
  const data = await fetchFundData(symbol, name, { token });
  const holdings = data.holdings ?? [];
  const total = holdings.reduce((sum, holding) => sum + (holding.holdingPercent || 0), 0);
  // Providers either send fractions (0.08) or percentages (8); normalize to %.
  const scale = total > 1.5 ? 1 : 100;

  return {
    symbol,
    source: data.source,
    category: data.categoryName,
    lookthrough: data.lookthrough ?? null,
    note: data.note ?? null,
    holdings: holdings.slice(0, 20).map((holding) => ({
      name: holding.holdingName,
      symbol: holding.symbol,
      percent: round((holding.holdingPercent || 0) * scale),
    })),
    sectors: (data.sectorWeightings ?? []).slice(0, 10).map((sector) => ({
      sector: sector.sector,
      percent: round(sector.percentage),
    })),
    assetAllocation: data.assetAllocation ?? null,
  };
}

/**
 * Runs one model-requested tool against the screen's already-loaded portfolio
 * data and public API clients. Always returns a JSON string because that is
 * what the model receives as the tool result.
 */
export async function executeAssistantTool(
  name: string,
  rawArguments: string,
  context: AssistantContext,
  options: { token?: string | null } = {},
): Promise<string> {
  let args: any = {};
  try {
    args = rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    args = {};
  }

  try {
    switch (name) {
      case 'get_portfolio_summary':
        return JSON.stringify(portfolioSummary(context));
      case 'get_exposure_summary':
        return JSON.stringify(exposureSummary(context));
      case 'search_asset': {
        const query = String(args.query || '').trim();
        if (!query) return JSON.stringify({ error: 'A search query is required.' });
        return JSON.stringify({ results: await searchAsset(query, options.token) });
      }
      case 'get_quote': {
        const symbol = String(args.symbol || '').trim();
        if (!symbol) return JSON.stringify({ error: 'A symbol is required.' });
        return JSON.stringify(await quote(symbol, options.token));
      }
      case 'get_fund_holdings': {
        const symbol = String(args.symbol || '').trim();
        if (!symbol) return JSON.stringify({ error: 'A fund or ETF symbol is required.' });
        const fundName = typeof args.name === 'string' ? args.name : undefined;
        return JSON.stringify(await fundHoldings(symbol, fundName, options.token));
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : 'The lookup failed.',
    });
  }
}
