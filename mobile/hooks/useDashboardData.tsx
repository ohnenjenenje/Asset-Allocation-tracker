import React, { createContext, useContext, useEffect, useMemo, useRef, ReactNode } from 'react';
import { PriceData } from '@/lib/types';
import { usePortfolio } from '@/hooks/usePortfolioData';
import { usePrices } from '@/hooks/usePrices';
import { usePortfolioCalculations } from '@/hooks/usePortfolioCalculations';
import { useCryptoSync } from '@/hooks/useCryptoSync';
import { useAuth } from '@/hooks/useAuth';
import { Asset } from '@/lib/types';

export type DashboardData = ReturnType<typeof useDashboardDataInternal>;

const DashboardContext = createContext<DashboardData | null>(null);

export function useDashboard(): DashboardData {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error('useDashboard must be used inside DashboardProvider');
  return ctx;
}

function useDashboardDataInternal() {
  const setPricesRef = useRef<React.Dispatch<React.SetStateAction<Record<string, PriceData>>>>(() => {});

  const { user, isAuthReady } = useAuth();
  const portfolio = usePortfolio();
  const { assets, fundHoldings, idealAllocation, cachedCrypto, syncToDb } = portfolio;

  const crypto = useCryptoSync(cachedCrypto, syncToDb, (...args) => setPricesRef.current(...args), !!user && isAuthReady);
  const { binanceAssets, coindcxAssets, binanceStatus, coindcxStatus } = crypto;

  const pricingAssets = useMemo(() => {
    const list = [...assets];
    if (binanceStatus.state === 'cached') {
      list.push(...binanceAssets.map((a) => ({ ...a, symbol: a.symbol?.replace('/USDT', '-USD') })) as Asset[]);
    }
    if (coindcxStatus.state === 'cached') {
      list.push(...coindcxAssets.map((a) => ({ ...a, symbol: a.symbol?.replace('/USDT', '-USD') })) as Asset[]);
    }
    return list;
  }, [assets, binanceStatus.state, binanceAssets, coindcxStatus.state, coindcxAssets]);

  const mergedAssets = useMemo(
    () => [...assets, ...binanceAssets, ...coindcxAssets],
    [assets, binanceAssets, coindcxAssets],
  );

  const { prices, setPrices, isLoadingPrices, priceProgress, fetchPrices } = usePrices(pricingAssets, fundHoldings);
  useEffect(() => {
    setPricesRef.current = setPrices;
  }, [setPrices]);

  const calculations = usePortfolioCalculations({
    mergedAssets,
    assets,
    prices,
    fundHoldings,
    idealAllocation,
  });

  return {
    ...portfolio,
    ...crypto,
    prices,
    setPrices,
    isLoadingPrices,
    priceProgress,
    fetchPrices,
    pricingAssets,
    mergedAssets,
    ...calculations,
  };
}

export function DashboardProvider({ children }: { children: ReactNode }) {
  const value = useDashboardDataInternal();
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
