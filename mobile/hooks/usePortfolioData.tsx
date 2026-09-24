import React, {
  createContext, useContext, useState, useEffect, useRef, ReactNode,
} from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { apiFetch } from '@/lib/api';
import { Asset } from '@/lib/types';
import { migrateIdealAllocation } from '@/lib/portfolio/allocationMigrations';
import { firestoreMongoRepository } from '@/lib/repositories/portfolioRepository';
import { useAuth } from '@/hooks/useAuth';

export type PortfolioContextValue = ReturnType<typeof usePortfolioDataInternal>;

const PortfolioContext = createContext<PortfolioContextValue | null>(null);

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolio must be used within PortfolioProvider');
  return ctx;
}

function usePortfolioDataInternal() {
  const { user, isAuthReady } = useAuth();

  const [assets, setAssets] = useState<Asset[]>([]);
  const [fundHoldings, setFundHoldings] = useState<Record<string, any>>({});
  const [holdingsErrors, setHoldingsErrors] = useState<Record<string, string>>({});
  const loadingHoldings = useRef<Record<string, boolean>>({});
  const [cachedCrypto, setCachedCrypto] = useState<any>(null);

  const [idealAllocation, setIdealAllocation] = useState<Record<string, number>>({
    'Equities': 60,
    'Fixed Income': 20,
    'Commodities': 5,
    'Crypto': 5,
    'Cash': 10,
  });

  const [openRouterKey, setOpenRouterKey] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [aiProvider, setAiProvider] = useState<'openrouter' | 'google'>('google');
  const [searchSource, setSearchSource] = useState<'indianapi' | 'yahoo' | 'newapi' | 'tickertape'>('tickertape');
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState('meta-llama/llama-3.3-70b-instruct:free');
  const [googleModel, setGoogleModel] = useState('gemini-3.1-flash-lite-preview');

  const syncToDb = async (updates: any) => {
    if (!user) return;
    await firestoreMongoRepository.save(user, updates, {
      assets, fundHoldings, idealAllocation, searchSource, openRouterKey, aiProvider, googleModel, selectedModel,
    });
  };

  const handleRestoreFromMongo = async () => {
    if (!user) return;
    setRestoreStatus({ message: 'Restoring...', isError: false });
    try {
      const res = await apiFetch(`/api/sync?uid=${user.uid}`);
      const data = await res.json();
      if (data.success && data.data) {
        const importedData = data.data;
        if (importedData.assets) setAssets(importedData.assets);
        if (importedData.fundHoldings) setFundHoldings(importedData.fundHoldings);
        if (importedData.settings) {
          if (importedData.settings.idealAllocation) setIdealAllocation(importedData.settings.idealAllocation);
          if (importedData.settings.searchSource) setSearchSource(importedData.settings.searchSource);
          if (importedData.settings.aiProvider) setAiProvider(importedData.settings.aiProvider);
          if (importedData.settings.openrouterModel) setSelectedModel(importedData.settings.openrouterModel);
          if (importedData.settings.googleModel) setGoogleModel(importedData.settings.googleModel);
        }
        await syncToDb({
          assets: importedData.assets || assets,
          fundHoldings: importedData.fundHoldings || fundHoldings,
          settings: importedData.settings || {},
        });
        setRestoreStatus({ message: 'Successfully restored portfolio from MongoDB backup!', isError: false });
      } else {
        setRestoreStatus({ message: 'No backup found or failed to restore: ' + (data.error || 'Unknown error'), isError: true });
      }
    } catch (e) {
      setRestoreStatus({ message: 'Error restoring from backup: ' + e, isError: true });
    }
    setTimeout(() => setRestoreStatus(null), 4000);
  };

  const saveOpenRouterKey = (key: string) => {
    setOpenRouterKey(key);
    syncToDb({ settings: { openRouterKey: key } });
  };

  const forceRefreshHoldings = () => {
    const newHoldings = { ...fundHoldings };
    let changed = false;
    assets.forEach((asset) => {
      const type = String(asset.type || '').toUpperCase();
      const nameLower = String(asset.name || '').toLowerCase();
      const symLower = String(asset.symbol || '').toLowerCase();
      const isLikelyETF = type === 'ETF' || nameLower.includes('etf') || nameLower.includes('bees') || symLower.includes('bees') || symLower === 'alpha.ns' || symLower === 'alpha.bo';
      const isFund = type === 'MUTUALFUND' || isLikelyETF;
      if (isFund && newHoldings[asset.symbol]) {
        delete newHoldings[asset.symbol];
        loadingHoldings.current[asset.symbol] = false;
        changed = true;
      }
    });
    if (changed) setFundHoldings(newHoldings);
  };

  // ---- Load data on auth ----
  useEffect(() => {
    if (!isAuthReady || !user) return;
    let isMounted = true;

    const loadData = async () => {
      try {
        const data = await firestoreMongoRepository.load(user);
        if (!isMounted) return;

        if (!data) {
          const initialData = { uid: user.uid, assets: [], fundHoldings: {}, settings: {} };
          const userRef = doc(db, 'users', user.uid);
          await setDoc(userRef, initialData);
          apiFetch('/api/sync', {
            method: 'POST',
            body: JSON.stringify({ uid: user.uid, email: user.email, displayName: user.displayName, data: initialData }),
          }).catch(() => {});
          return;
        }

        if (data.assets) setAssets(data.assets);
        if (data.fundHoldings) setFundHoldings(data.fundHoldings);
        if (data.cachedCrypto) setCachedCrypto(data.cachedCrypto);

        if (data.settings) {
          if (data.settings.idealAllocation) {
            const { migrated, needsSync } = migrateIdealAllocation(data.settings.idealAllocation);
            if (needsSync) syncToDb({ settings: { idealAllocation: migrated } });
            setIdealAllocation(migrated);
          }
          if (data.settings.searchSource) setSearchSource(data.settings.searchSource);
          if (data.settings.openRouterKey) setOpenRouterKey(data.settings.openRouterKey);
          if (data.settings.aiProvider) setAiProvider(data.settings.aiProvider);
          if (data.settings.googleModel) {
            const validModels = ['gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview', 'gemini-flash-latest'];
            if (validModels.includes(data.settings.googleModel)) {
              setGoogleModel(data.settings.googleModel);
            } else {
              setGoogleModel('gemini-3.1-flash-lite-preview');
              syncToDb({ settings: { googleModel: 'gemini-3.1-flash-lite-preview' } });
            }
          }
          if (data.settings.openrouterModel) {
            if (data.settings.openrouterModel === 'openrouter/free' || data.settings.openrouterModel === 'google/gemini-2.5-flash:free') {
              setSelectedModel('meta-llama/llama-3.3-70b-instruct:free');
              syncToDb({ settings: { openrouterModel: 'meta-llama/llama-3.3-70b-instruct:free' } });
            } else {
              setSelectedModel(data.settings.openrouterModel);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load portfolio data:', err);
      }
    };

    loadData();
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAuthReady]);

  // ---- Available AI models ----
  useEffect(() => {
    apiFetch('/api/models')
      .then(async (res) => {
        try { return await res.json(); } catch { return null; }
      })
      .then((data) => {
        if (data?.data) {
          const freeModels = data.data.filter((m: any) =>
            m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0' &&
            m.supported_parameters?.includes('tools'));
          setAvailableModels(freeModels);
        }
      })
      .catch(console.error);
  }, []);

  // ---- Lazy-load MF/ETF holdings ----
  useEffect(() => {
    assets.forEach((asset) => {
      const existing = fundHoldings[asset.symbol];
      const hasStaleFields = existing?.assetAllocation && !('stockPosition' in existing.assetAllocation);
      const missingMarketCap = existing && !('marketCapWeightage' in existing);

      const type = String(asset.type || '').toUpperCase();
      const nameLower = String(asset.name || '').toLowerCase();
      const symLower = String(asset.symbol || '').toLowerCase();
      const isLikelyETF = type === 'ETF' || nameLower.includes('etf') || nameLower.includes('bees') || symLower.includes('bees') || symLower === 'alpha.ns' || symLower === 'alpha.bo';
      const isFund = type === 'MUTUALFUND' || isLikelyETF;

      const needsFetch = isFund && (!existing || hasStaleFields || missingMarketCap) && !loadingHoldings.current[asset.symbol];

      if (needsFetch) {
        loadingHoldings.current[asset.symbol] = true;
        apiFetch(`/api/holdings?symbol=${encodeURIComponent(asset.symbol)}&name=${encodeURIComponent(asset.name || '')}`)
          .then(async (res) => {
            const contentType = res.headers.get('content-type');
            const text = await res.text();
            if (!res.ok || (contentType && !contentType.includes('application/json'))) {
              throw new Error(`Failed to fetch holdings: ${res.status}`);
            }
            return JSON.parse(text);
          })
          .then((data) => {
            if (data && data.holdings && data.holdings.length > 0) {
              setFundHoldings((prev) => {
                const newHoldings = { ...prev, [asset.symbol]: data };
                syncToDb({ fundHoldings: newHoldings });
                return newHoldings;
              });
              setHoldingsErrors((prev) => {
                const n = { ...prev };
                delete n[asset.symbol];
                return n;
              });
            } else {
              throw new Error('No holdings data returned');
            }
          })
          .catch((err) => {
            console.error(`Error fetching holdings for ${asset.symbol}:`, err);
            setHoldingsErrors((prev) => ({ ...prev, [asset.symbol]: 'Failed to load holdings' }));
          })
          .finally(() => {
            loadingHoldings.current[asset.symbol] = false;
          });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, fundHoldings]);

  return {
    assets, setAssets,
    fundHoldings, setFundHoldings,
    cachedCrypto, setCachedCrypto,
    holdingsErrors, setHoldingsErrors,
    loadingHoldings,
    idealAllocation, setIdealAllocation,
    openRouterKey, setOpenRouterKey,
    restoreStatus, setRestoreStatus,
    aiProvider, setAiProvider,
    searchSource, setSearchSource,
    availableModels,
    selectedModel, setSelectedModel,
    googleModel, setGoogleModel,
    syncToDb,
    handleRestoreFromMongo,
    saveOpenRouterKey,
    forceRefreshHoldings,
  };
}

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const value = usePortfolioDataInternal();
  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>;
}
