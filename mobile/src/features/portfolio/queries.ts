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
  ScreenerFilters,
} from './types';

export const portfolioKeys = {
  all: ['portfolio'] as const,
  snapshot: (uid: string) => [...portfolioKeys.all, 'snapshot', uid] as const,
  prices: (symbols: readonly string[]) =>
    [...portfolioKeys.all, 'prices', [...symbols].sort().join(',')] as const,
  fund: (symbol: string) => [...portfolioKeys.all, 'fund', symbol] as const,
  screener: (filters: ScreenerFilters) => ['screener', filters] as const,
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
    enabled: status === 'signedIn' && !isDemo && unique.length > 0,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

interface FundRequest {
  symbol: string;
  name: string;
}

/**
 * Look-through data for every held fund/ETF.
 *
 * Funds already cached on the user snapshot are used as seeds and never
 * refetched; only gaps trigger `/api/holdings`. Results stay in the query cache
 * for a day because holdings change quarterly at most.
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
      enabled:
        status === 'signedIn' &&
        !isDemo &&
        !hasFundLookThrough(seeds?.[fund.symbol]),
      staleTime: 24 * 60 * 60_000,
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
  const { isDemo } = useAuth();

  const savedAssets = useMemo<Asset[]>(
    () => (isDemo ? demoAssets : (snapshotQuery.data?.assets ?? [])),
    [isDemo, snapshotQuery.data],
  );

  // Exchange balances are read-only; the web dashboard caches them on the same
  // user document. Normalize old `/USDT` symbols and merge them for display.
  const cachedExchange = useMemo(
    () =>
      isDemo
        ? { assets: [] as Asset[], prices: {}, lastSynced: 0 }
        : readCachedExchange(snapshotQuery.data?.cachedCrypto),
    [isDemo, snapshotQuery.data],
  );

  const assets = useMemo<Asset[]>(
    () => [...savedAssets, ...cachedExchange.assets],
    [savedAssets, cachedExchange.assets],
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
    // Cached exchange quotes keep last-known values visible while fresh Yahoo
    // quotes are loading; fresh quotes win once they arrive.
    return { ...cachedExchange.prices, ...(pricesQuery.data ?? {}) };
  }, [isDemo, cachedExchange.prices, pricesQuery.data]);
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
    isLoading: isDemo ? false : snapshotQuery.isLoading,
    isRefreshing: isDemo
      ? false
      : snapshotQuery.isRefetching || pricesQuery.isRefetching,
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
