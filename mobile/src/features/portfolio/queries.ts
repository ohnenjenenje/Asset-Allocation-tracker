import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuth } from '@/src/features/auth/AuthProvider';

import { DEFAULT_USD_TO_INR, flattenAssets, summarize } from './aggregate';
import { analyzePortfolio, DEFAULT_IDEAL_ALLOCATION, hasFundLookThrough } from './analytics';
import {
  fetchExchangeBalances,
  fetchFundData,
  fetchPrices,
  fetchScreener,
  fetchSnapshot,
  savePolicy,
  savePortfolio,
} from './api';
import { demoAssets, demoFundHoldings, demoPrices, screenDemoStocks } from './demo';
import { isFundAsset, readCachedExchange } from './normalize';
import {
  buildPolicyHistory,
  buildPolicyUpdate,
  evaluatePolicy,
  resolvePolicyConfig,
  type PolicyConfig,
} from './policy';
import type {
  Asset,
  FundData,
  Policy,
  PolicyCurrencyConfig,
  PolicyDecisionLevel,
  PolicyLiquidityConfig,
  PolicyRange,
  PolicyReviewCadence,
  PolicyRiskModel,
  PortfolioSnapshot,
  PriceData,
  ScreenerFilters,
} from './types';

export const portfolioKeys = {
  all: ['portfolio'] as const,
  snapshot: (uid: string) => [...portfolioKeys.all, 'snapshot', uid] as const,
  prices: (symbols: readonly string[]) =>
    [...portfolioKeys.all, 'prices', [...symbols].sort().join(',')] as const,
  fund: (symbol: string) => [...portfolioKeys.all, 'fund', symbol] as const,
  exchange: (name: 'binance' | 'coindcx') =>
    [...portfolioKeys.all, 'exchange', name] as const,
  screener: (filters: ScreenerFilters) => ['screener', filters] as const,
};

export type ExchangeSyncIssue = {
  name: 'Binance' | 'CoinDCX';
  message: string;
};

/**
 * Wall-clock start of the current first load. Shared across screens so a tab
 * mounted mid-load shows the same remaining-time estimate as the dashboard.
 */
let portfolioLoadStartedAt: number | null = null;

export function usePortfolioSnapshot() {
  const { uid, status, isDemo, getToken } = useAuth();

  return useQuery({
    queryKey: portfolioKeys.snapshot(uid ?? 'anonymous'),
    queryFn: async ({ signal }) => {
      portfolioLoadStartedAt = Date.now();
      return fetchSnapshot(uid!, { signal, token: await getToken() });
    },
    enabled: status === 'signedIn' && !isDemo && Boolean(uid),
    staleTime: 60_000,
    // One retry is enough; the persisted cache already keeps the UI usable
    // while the backend wakes up.
    retry: 1,
  });
}

export function usePrices(symbols: readonly string[]) {
  const { status, isDemo, getToken } = useAuth();
  const unique = useMemo(() => [...new Set(symbols.filter(Boolean))], [symbols]);

  return useQuery({
    queryKey: portfolioKeys.prices(unique),
    queryFn: async ({ signal }) =>
      fetchPrices(unique, { signal, token: await getToken() }),
    // The backend returns live quotes by default and never writes to the
    // sheet unless `sync=true` is explicit, so this remains read-only.
    enabled: status === 'signedIn' && !isDemo && unique.length > 0,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

/**
 * Live exchange balances. The web dashboard is no longer the only writer:
 * mobile refreshes the same server-side integrations, and falls back to the
 * snapshot cache (with its age visible) when an exchange is unavailable.
 */
function useExchangeBalances() {
  const { status, isDemo, getToken } = useAuth();
  const enabled = status === 'signedIn' && !isDemo;

  const binance = useQuery({
    queryKey: portfolioKeys.exchange('binance'),
    queryFn: async ({ signal }) =>
      fetchExchangeBalances('binance', { signal, token: await getToken() }),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 0,
  });

  const coindcx = useQuery({
    queryKey: portfolioKeys.exchange('coindcx'),
    queryFn: async ({ signal }) =>
      fetchExchangeBalances('coindcx', { signal, token: await getToken() }),
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 0,
  });

  return {
    binance,
    coindcx,
    isFetching: binance.isFetching || coindcx.isFetching,
    isRefetching: binance.isRefetching || coindcx.isRefetching,
    refetch: async () => {
      await Promise.all([binance.refetch(), coindcx.refetch()]);
    },
  };
}

function exchangePrices(
  assets: Asset[],
  asOf: number,
  source: string,
  stale: boolean,
): Record<string, PriceData> {
  const quotes: Record<string, PriceData> = {};
  for (const asset of assets) {
    const price = Number(asset.currentPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    quotes[asset.symbol] = {
      symbol: asset.symbol,
      regularMarketPrice: price,
      currency: asset.currency || 'USD',
      shortName: asset.name,
      quoteType: asset.type === 'CASH' ? 'CASH' : 'CRYPTO',
      source,
      lastUpdated: asOf,
      asOf,
      stale,
    };
  }
  return quotes;
}

interface FundRequest {
  symbol: string;
  name: string;
}

/**
 * Look-through data for every held fund/ETF.
 *
 * Snapshot seeds render immediately, but the query is still enabled so they
 * refresh in the background. A weekly stale time matches how often fund
 * compositions change; gaps still participate in the loading progress.
 */
export function useFundHoldings(
  requests: readonly FundRequest[],
  seeds: Record<string, FundData> | undefined,
) {
  const { status, isDemo, getToken } = useAuth();

  const unique = useMemo(() => {
    const seen = new Set<string>();
    return requests.filter((request) => {
      if (!request.symbol || seen.has(request.symbol)) return false;
      seen.add(request.symbol);
      return true;
    });
  }, [requests]);

  const queries = useQueries({
    queries: unique.map((fund) => ({
      queryKey: portfolioKeys.fund(fund.symbol),
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        fetchFundData(fund.symbol, fund.name, { signal, token: await getToken() }),
      enabled: status === 'signedIn' && !isDemo,
      // Seeds render instantly. Their stored refresh time lets a recent web
      // fetch suppress redundant work while older data refreshes in the
      // background; untimestamped legacy seeds are treated as stale.
      initialData: seeds?.[fund.symbol],
      initialDataUpdatedAt: seeds?.[fund.symbol]?.lastUpdated ?? 0,
      staleTime: 7 * 24 * 60 * 60_000,
      gcTime: 7 * 24 * 60 * 60_000,
      retry: 1,
    })),
  });

  const data = useMemo(() => {
    const merged: Record<string, FundData> = { ...(seeds ?? {}) };
    queries.forEach((query, index) => {
      if (query.data) merged[unique[index].symbol] = query.data;
    });
    return merged;
  }, [queries, seeds, unique]);

  const errorQuery = queries.find((query) => query.error);
  const loading = queries.filter((query) => query.isLoading);
  const enabled = status === 'signedIn' && !isDemo;
  const total = enabled
    ? unique.filter((fund) => !hasFundLookThrough(seeds?.[fund.symbol])).length
    : 0;
  // Only settled queries count; a query that has not started yet must not
  // make the overall progress jump forward.
  const completed = queries.filter(
    (query, index) =>
      !hasFundLookThrough(seeds?.[unique[index].symbol]) &&
      (query.isSuccess || query.isError),
  ).length;

  return {
    data,
    isLoading: loading.length > 0,
    error: (errorQuery?.error as Error | undefined) ?? null,
    pending: loading.length,
    completed: Math.min(total, completed),
    total,
    refetch: async () => {
      await Promise.all(queries.map((query) => query.refetch()));
    },
  };
}

export type PortfolioLoadStage = 'snapshot' | 'prices' | 'funds' | 'done';

/** Raw loading state the UI turns into a progress bar and remaining-work copy. */
export interface PortfolioLoadProgress {
  /** Any first load still running. Background refetches are excluded. */
  active: boolean;
  stage: PortfolioLoadStage;
  /** When the snapshot request started, for the shared time estimate. */
  startedAt: number | null;
  pricesDone: boolean;
  fundsCompleted: number;
  fundsTotal: number;
}

/**
 * One hook for every number the UI needs. Demo mode resolves entirely from the
 * bundled dataset, so the dashboard renders with zero network access.
 */
export function usePortfolioData() {
  const snapshotQuery = usePortfolioSnapshot();
  const exchangeQuery = useExchangeBalances();
  const { isDemo } = useAuth();

  const binanceError = exchangeQuery.binance.error;
  const coindcxError = exchangeQuery.coindcx.error;
  const exchangeIssues = useMemo<ExchangeSyncIssue[]>(() => {
    const issues: ExchangeSyncIssue[] = [];
    if (binanceError) {
      issues.push({
        name: 'Binance',
        message:
          binanceError instanceof Error ? binanceError.message : 'Sync failed',
      });
    }
    if (coindcxError) {
      issues.push({
        name: 'CoinDCX',
        message:
          coindcxError instanceof Error ? coindcxError.message : 'Sync failed',
      });
    }
    return issues;
  }, [binanceError, coindcxError]);

  const savedAssets = useMemo<Asset[]>(
    () => (isDemo ? demoAssets : (snapshotQuery.data?.assets ?? [])),
    [isDemo, snapshotQuery.data],
  );

  // React Query returns a new result object every render, so the memo depends
  // on the stable fields inside it rather than the query objects themselves.
  const binanceSuccess = exchangeQuery.binance.isSuccess;
  const binanceData = exchangeQuery.binance.data;
  const binanceUpdatedAt = exchangeQuery.binance.dataUpdatedAt;
  const coindcxSuccess = exchangeQuery.coindcx.isSuccess;
  const coindcxData = exchangeQuery.coindcx.data;
  const coindcxUpdatedAt = exchangeQuery.coindcx.dataUpdatedAt;

  // Prefer live exchange balances; keep the snapshot cache only for exchanges
  // that did not answer, and preserve its age for the UI.
  const exchange = useMemo(() => {
    if (isDemo) {
      return {
        assets: [] as Asset[],
        prices: {} as Record<string, PriceData>,
        isCached: false,
        lastSyncedAt: null as number | null,
      };
    }

    const cached = readCachedExchange(snapshotQuery.data?.cachedCrypto);
    const sources = [
      {
        name: 'Binance',
        success: binanceSuccess,
        assets: binanceData,
        updatedAt: binanceUpdatedAt,
      },
      {
        name: 'CoinDCX',
        success: coindcxSuccess,
        assets: coindcxData,
        updatedAt: coindcxUpdatedAt,
      },
    ];
    const liveNames = new Set(
      sources
        .filter((source) => source.success)
        .map((source) => source.name.toLowerCase()),
    );

    const staleAssets = cached.assets.filter(
      (asset) => !liveNames.has((asset.exchange ?? '').toLowerCase()),
    );
    const staleSymbols = new Set(staleAssets.map((asset) => asset.symbol));
    const stalePrices = Object.fromEntries(
      Object.entries(cached.prices).filter(([symbol]) => staleSymbols.has(symbol)),
    ) as Record<string, PriceData>;

    const liveAssets: Asset[] = [];
    const livePrices: Record<string, PriceData> = {};
    const syncedAt: number[] = [];

    for (const source of sources) {
      if (!source.success || !source.assets) continue;
      liveAssets.push(...source.assets);
      Object.assign(
        livePrices,
        exchangePrices(source.assets, source.updatedAt, `${source.name} API`, false),
      );
      syncedAt.push(source.updatedAt);
    }

    for (const asset of staleAssets) {
      const asOf = Number(cached.prices[asset.symbol]?.asOf);
      if (Number.isFinite(asOf) && asOf > 0) syncedAt.push(asOf);
    }

    return {
      assets: [...staleAssets, ...liveAssets],
      prices: { ...stalePrices, ...livePrices },
      isCached: staleAssets.length > 0,
      lastSyncedAt: syncedAt.length > 0 ? Math.max(...syncedAt) : null,
    };
  }, [
    isDemo,
    snapshotQuery.data,
    binanceSuccess,
    binanceData,
    binanceUpdatedAt,
    coindcxSuccess,
    coindcxData,
    coindcxUpdatedAt,
  ]);

  const assets = useMemo<Asset[]>(
    () => [...savedAssets, ...exchange.assets],
    [savedAssets, exchange.assets],
  );

  const symbols = useMemo(() => {
    const quoteSymbols = flattenAssets(assets)
      .filter((asset) => asset.manualPrice == null)
      .map((asset) => asset.symbol)
      .filter(Boolean);

    // USD holdings need the live FX rate. Some saved crypto rows store the
    // entry currency as INR, so also detect the `-USD` symbol convention.
    const hasUsdExposure = flattenAssets(assets).some(
      (asset) => asset.currency === 'USD' || asset.symbol.endsWith('-USD'),
    );
    return hasUsdExposure ? [...quoteSymbols, 'INR=X'] : quoteSymbols;
  }, [assets]);

  const pricesQuery = usePrices(symbols);
  const prices = useMemo(() => {
    if (isDemo) return demoPrices;
    // Cached exchange quotes keep last-known values visible while fresh quotes
    // are loading; live exchange and Yahoo quotes win once they arrive.
    return { ...exchange.prices, ...(pricesQuery.data ?? {}) };
  }, [isDemo, exchange.prices, pricesQuery.data]);

  const quoteFreshness = useMemo(() => {
    const quotes = Object.values(prices).filter(
      (quote) => quote.regularMarketPrice != null,
    );
    const timestamps = quotes
      .map((quote) => quote.asOf)
      .filter((value): value is number => typeof value === 'number' && value > 0);

    return {
      quotesAsOf: timestamps.length > 0 ? Math.min(...timestamps) : null,
      staleQuoteCount: quotes.filter((quote) => quote.stale).length,
    };
  }, [prices]);
  const usdToInr = prices['INR=X']?.regularMarketPrice ?? DEFAULT_USD_TO_INR;

  const fundRequests = useMemo<FundRequest[]>(
    () =>
      flattenAssets(assets)
        .filter(isFundAsset)
        .map((asset) => ({ symbol: asset.symbol, name: asset.name })),
    [assets],
  );
  const seededFundHoldings = isDemo
    ? demoFundHoldings
    : snapshotQuery.data?.fundHoldings;
  const fundQuery = useFundHoldings(fundRequests, seededFundHoldings);
  const fundHoldings = isDemo ? demoFundHoldings : fundQuery.data;

  const policyConfig = useMemo<PolicyConfig>(() => {
    // The demo ships with the default targets treated as a confirmed policy so
    // the allocation health card and planner are fully explorable. Writes stay
    // disabled: policy editing and rebalance recording remain read-only.
    if (isDemo) {
      return resolvePolicyConfig({ settingsAllocation: DEFAULT_IDEAL_ALLOCATION });
    }

    const snapshot = snapshotQuery.data;
    return resolvePolicyConfig({
      policy: snapshot?.policy ?? null,
      policyHistory: snapshot?.policyHistory ?? null,
      settingsAllocation: snapshot?.settings?.idealAllocation ?? null,
      topLevelAllocation: snapshot?.idealAllocation ?? null,
      updatedAt: snapshot?.updatedAt,
    });
  }, [isDemo, snapshotQuery.data]);
  const idealAllocation = policyConfig.targets;

  const summary = useMemo(() => summarize(assets, prices, usdToInr), [assets, prices, usdToInr]);

  const analytics = useMemo(
    () =>
      analyzePortfolio({
        assets,
        prices,
        fundHoldings,
        idealAllocation,
        usdToInr,
      }),
    [assets, prices, fundHoldings, idealAllocation, usdToInr],
  );

  const policyEvaluation = useMemo(
    () =>
      evaluatePolicy({
        nodes: analytics.allocationAnalysis,
        config: policyConfig,
        total: analytics.totals.portfolio,
      }),
    [analytics.allocationAnalysis, analytics.totals.portfolio, policyConfig],
  );

  const snapshotLoading = isDemo ? false : snapshotQuery.isLoading;
  // Treat a task as pending until it settles, not merely while a fetch is in
  // flight. Otherwise the percentage can move backwards in the brief gap
  // between the snapshot arriving and the dependent queries starting.
  const pricesDone =
    isDemo || symbols.length === 0 || pricesQuery.isSuccess || pricesQuery.isError;
  const fundsDone =
    isDemo || fundQuery.total === 0 || fundQuery.completed >= fundQuery.total;
  const stage: PortfolioLoadStage = snapshotLoading
    ? 'snapshot'
    : !pricesDone
      ? 'prices'
      : !fundsDone
        ? 'funds'
        : 'done';
  const progress: PortfolioLoadProgress = {
    active: stage !== 'done',
    stage,
    startedAt: portfolioLoadStartedAt,
    pricesDone,
    fundsCompleted: isDemo ? 0 : fundQuery.completed,
    fundsTotal: isDemo ? 0 : fundQuery.total,
  };

  return {
    assets,
    savedAssets,
    prices,
    summary,
    analytics,
    fundHoldings,
    idealAllocation,
    policyConfig,
    policyEvaluation,
    fundCoverage: analytics.fundCoverage,
    isDemo,
    progress,
    lastSyncedAt: isDemo ? null : snapshotQuery.dataUpdatedAt || null,
    quotesAsOf: quoteFreshness.quotesAsOf,
    staleQuoteCount: quoteFreshness.staleQuoteCount,
    exchangeIsCached: exchange.isCached,
    exchangeLastSyncedAt: exchange.lastSyncedAt,
    exchangeIssues,
    isLoading: isDemo ? false : snapshotQuery.isLoading,
    isRefreshing: isDemo
      ? false
      : snapshotQuery.isRefetching ||
        pricesQuery.isRefetching ||
        exchangeQuery.isRefetching,
    isFundLoading: isDemo ? false : fundQuery.isLoading,
    error: snapshotQuery.error,
    priceError: pricesQuery.error,
    fundError: fundQuery.error,
    refetch: async () => {
      if (isDemo) return;
      await Promise.all([
        snapshotQuery.refetch(),
        pricesQuery.refetch(),
        fundQuery.refetch(),
        exchangeQuery.refetch(),
      ]);
    },
    refetchFunds: fundQuery.refetch,
  };
}

interface MutationContext {
  key: readonly unknown[];
  previous: PortfolioSnapshot | null | undefined;
}

/** Optimistic save with rollback — the UI updates instantly, errors are safe. */
export function useSaveAssets() {
  const queryClient = useQueryClient();
  const { uid, user, getToken } = useAuth();

  return useMutation<void, Error, Asset[], MutationContext>({
    mutationFn: async (assets) => {
      if (!uid) throw new Error('You must be signed in to save changes.');
      await savePortfolio({
        uid,
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
        assets,
        token: await getToken(),
      });
    },
    onMutate: async (assets) => {
      if (!uid) return { key: [], previous: undefined };
      const key = portfolioKeys.snapshot(uid);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<PortfolioSnapshot | null>(key);
      queryClient.setQueryData<PortfolioSnapshot | null>(key, (old) =>
        old ? { ...old, assets } : { assets },
      );
      return { key, previous };
    },
    onError: (_error, _assets, context) => {
      if (context && context.key.length > 0) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSettled: () => {
      if (uid) void queryClient.invalidateQueries({ queryKey: portfolioKeys.snapshot(uid) });
    },
  });
}

export interface SavePolicyVariables {
  targets: Record<string, number>;
  bands: Record<string, number>;
  reviewCadence: PolicyReviewCadence;
  ranges?: Record<string, PolicyRange>;
  decisionLevels?: Record<string, PolicyDecisionLevel>;
  benchmarks?: Record<string, string>;
  sectorTargets?: Record<string, number>;
  sectorRanges?: Record<string, PolicyRange>;
  riskBudget?: Record<string, number>;
  riskModel?: PolicyRiskModel;
  currencyPolicy?: PolicyCurrencyConfig;
  liquidityPolicy?: PolicyLiquidityConfig;
  allowUnallocated?: boolean;
  notes?: string;
  approvedBy?: string;
  changeNote?: string;
}

interface SavedPolicy {
  policy: Policy;
  history: Policy[];
}

function resolveCachedPolicyConfig(
  queryClient: QueryClient,
  uid: string,
): PolicyConfig {
  const snapshot = queryClient.getQueryData<PortfolioSnapshot | null>(
    portfolioKeys.snapshot(uid),
  );
  return resolvePolicyConfig({
    policy: snapshot?.policy ?? null,
    policyHistory: snapshot?.policyHistory ?? null,
    settingsAllocation: snapshot?.settings?.idealAllocation ?? null,
    topLevelAllocation: snapshot?.idealAllocation ?? null,
    updatedAt: snapshot?.updatedAt,
  });
}

/**
 * Confirm a new policy version. The previous confirmed policy is retained in a
 * small audit trail; targets are dual-written for web compatibility.
 */
export function useSavePolicy() {
  const queryClient = useQueryClient();
  const { uid, user, getToken, isDemo } = useAuth();

  return useMutation<SavedPolicy, Error, SavePolicyVariables>({
    mutationFn: async (variables) => {
      if (!uid) throw new Error('You must be signed in to save a policy.');
      if (isDemo) throw new Error('Policy editing is disabled in demo mode.');

      const config = resolveCachedPolicyConfig(queryClient, uid);
      const policy = buildPolicyUpdate({
        existing: config.policy,
        targets: variables.targets,
        bands: variables.bands,
        reviewCadence: variables.reviewCadence,
        ranges: variables.ranges,
        decisionLevels: variables.decisionLevels,
        benchmarks: variables.benchmarks,
        sectorTargets: variables.sectorTargets,
        sectorRanges: variables.sectorRanges,
        riskBudget: variables.riskBudget,
        riskModel: variables.riskModel,
        currencyPolicy: variables.currencyPolicy,
        liquidityPolicy: variables.liquidityPolicy,
        allowUnallocated: variables.allowUnallocated,
        notes: variables.notes,
        approvedBy: variables.approvedBy,
        changeNote: variables.changeNote,
      });
      const history = buildPolicyHistory(config.policy, config.history);

      await savePolicy({
        uid,
        email: user?.email ?? null,
        displayName: user?.displayName ?? null,
        policy,
        history,
        token: await getToken(),
      });

      return { policy, history };
    },
    onSuccess: ({ policy, history }) => {
      if (!uid) return;
      const key = portfolioKeys.snapshot(uid);
      queryClient.setQueryData<PortfolioSnapshot | null>(key, (old) =>
        old
          ? {
              ...old,
              policy,
              policyHistory: history,
              settings: { ...old.settings, idealAllocation: policy.targets },
            }
          : old,
      );
      void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useScreener(filters: ScreenerFilters, enabled = true) {
  const { getToken, isDemo } = useAuth();

  return useQuery({
    queryKey: [...portfolioKeys.screener(filters), { demo: isDemo }],
    queryFn: async ({ signal }) =>
      isDemo
        ? screenDemoStocks(filters)
        : fetchScreener(filters, { signal, token: await getToken() }),
    enabled,
    staleTime: isDemo ? Infinity : 5 * 60_000,
    retry: 0,
  });
}
