import { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react';
import { User } from 'firebase/auth';
import { doc, setDoc, updateDoc, onSnapshot, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { Asset, PriceData } from '@/lib/types';

type SearchSource = 'indianapi' | 'yahoo' | 'tickertape';

/** Bump when the holdings payload shape changes so cached data is refreshed once. */
const HOLDINGS_SCHEMA_VERSION = 2;

const hasValidSectorWeights = (sectors: any): boolean =>
  Array.isArray(sectors) &&
  sectors.some((sector: any) => sector?.sector && Number(sector.percentage) > 0);

const hasPositiveWeights = (weights: any): boolean =>
  Boolean(weights) &&
  ['largeCap', 'midCap', 'smallCap', 'others'].some((key) => Number(weights[key]) > 0);

const hasPositiveAllocation = (allocation: any): boolean =>
  Boolean(allocation) && Object.values(allocation).some((value) => Number(value) > 0);

/**
 * Providers are inconsistent: one response may contain the full holdings list
 * and market-cap weights while the next contains only the top ten names. Never
 * replace richer cached data with a poorer response; refresh only the fields
 * that are valid and keep the rest.
 */
const mergeFundHoldings = (existing: any, fresh: any) => {
  const existingHoldings = Array.isArray(existing?.holdings) ? existing.holdings : [];
  const freshHoldings = Array.isArray(fresh?.holdings) ? fresh.holdings : [];
  const holdings = freshHoldings.length >= existingHoldings.length
    ? freshHoldings
    : existingHoldings;

  const sectorWeightings = hasValidSectorWeights(fresh?.sectorWeightings)
    ? fresh.sectorWeightings
    : hasValidSectorWeights(existing?.sectorWeightings)
      ? existing.sectorWeightings
      : [];

  const assetAllocation = hasPositiveAllocation(fresh?.assetAllocation)
    ? fresh.assetAllocation
    : existing?.assetAllocation && 'stockPosition' in existing.assetAllocation
      ? existing.assetAllocation
      : null;

  const marketCapWeightage = hasPositiveWeights(fresh?.marketCapWeightage)
    ? fresh.marketCapWeightage
    : hasPositiveWeights(existing?.marketCapWeightage)
      ? existing.marketCapWeightage
      : null;

  const hasSectors = hasValidSectorWeights(sectorWeightings);

  return {
    ...existing,
    ...fresh,
    holdings,
    sectorWeightings,
    assetAllocation,
    marketCapWeightage,
    categoryName: fresh?.categoryName || existing?.categoryName || null,
    schemaVersion: HOLDINGS_SCHEMA_VERSION,
    lastUpdated: Date.now(),
    // A fund that genuinely has no sector split should not be re-fetched on
    // every mount. A successful refresh clears the marker.
    sectorRefreshAttempted: !hasSectors,
  };
};

/** "newapi" pointed at a dead service; fold it (and unknown values) into Auto. */
const normalizeSearchSource = (value: unknown): SearchSource =>
  value === 'indianapi' || value === 'yahoo' ? value : 'tickertape';

export function usePortfolioData(
  user: User | null,
  isAuthReady: boolean
) {
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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<{message: string, isError: boolean} | null>(null);
  const [aiProvider, setAiProvider] = useState<'openrouter' | 'google'>('google');
  const [searchSource, setSearchSource] = useState<SearchSource>('tickertape');
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState('meta-llama/llama-3.3-70b-instruct:free');
  const [googleModel, setGoogleModel] = useState('gemini-3.1-flash-lite-preview');

  const syncToDb = async (updates: any) => {
    if (!user) return;
    
    // Helper to recursively remove undefined values
    const removeUndefined = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') return obj;
      if (Array.isArray(obj)) return obj.map(removeUndefined);
      return Object.fromEntries(
        Object.entries(obj)
          .filter(([_, v]) => v !== undefined)
          .map(([k, v]) => [k, removeUndefined(v)])
      );
    };

    const cleanUpdates = removeUndefined(updates);

    // MongoDB is the source of truth for the mobile app. Write it first so a
    // Firestore outage (or a missing Firestore database) cannot block saving.
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

      fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          data: cleanUpdates
        }),
        signal: controller.signal
      }).then(res => {
        clearTimeout(timeoutId);
        if (!res.ok && res.status !== 503) { // 503 means purposefully disabled
          console.warn('MongoDB sync returned status:', res.status);
        }
      }).catch(err => {
        clearTimeout(timeoutId);
        // Only log the error if it's not a deliberate abort or common network issue when starting up
        if (err.name !== 'AbortError') {
          console.debug('MongoDB sync skipped:', err.message);
        }
      });
    } catch (e) {
      // Ignore errors in the synchronous part of the sync setup
    }

    // Mirror to Firestore for the legacy web client when it is available.
    try {
      const userRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userRef);

      const firestoreUpdates: any = {};

      if (cleanUpdates.assets !== undefined) firestoreUpdates.assets = cleanUpdates.assets;
      if (cleanUpdates.fundHoldings !== undefined) firestoreUpdates.fundHoldings = cleanUpdates.fundHoldings;
      if (cleanUpdates.settings) {
        for (const [key, value] of Object.entries(cleanUpdates.settings)) {
          firestoreUpdates[`settings.${key}`] = value;
        }
      }
      // Forward dot-notation keys (e.g. cachedCrypto.binance) directly to Firestore
      for (const [key, value] of Object.entries(cleanUpdates)) {
        if (key.includes('.')) {
          firestoreUpdates[key] = value;
        }
      }

      if (Object.keys(firestoreUpdates).length > 0) {
        if (docSnap.exists()) {
          await updateDoc(userRef, firestoreUpdates);
        } else {
          // Initialize document if it doesn't exist
          const initialData = {
            uid: user.uid,
            assets: cleanUpdates.assets || assets,
            fundHoldings: cleanUpdates.fundHoldings || fundHoldings,
            settings: {
              idealAllocation,
              searchSource,
              openRouterKey,
              aiProvider,
              googleModel,
              openrouterModel: selectedModel,
              ...(cleanUpdates.settings || {})
            }
          };
          await setDoc(userRef, initialData);
        }
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user?.uid}`);
    }
  };

  const handleExportData = () => {
    const dataToExport = {
      assets,
      fundHoldings,
      settings: {
        idealAllocation,
        searchSource,
        aiProvider,
        openrouterModel: selectedModel,
        googleModel
      }
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleRestoreFromMongo = async () => {
    if (!user) return;
    setRestoreStatus({ message: 'Restoring...', isError: false });
    try {
      const res = await fetch(`/api/sync?uid=${user.uid}`);
      const data = await res.json();
      if (data.success && data.data) {
        const importedData = data.data;
        if (importedData.assets) setAssets(importedData.assets);
        if (importedData.fundHoldings) setFundHoldings(importedData.fundHoldings);
        if (importedData.settings) {
          if (importedData.settings.idealAllocation) setIdealAllocation(importedData.settings.idealAllocation);
          if (importedData.settings.searchSource) setSearchSource(normalizeSearchSource(importedData.settings.searchSource));
          if (importedData.settings.aiProvider) setAiProvider(importedData.settings.aiProvider);
          if (importedData.settings.openrouterModel) setSelectedModel(importedData.settings.openrouterModel);
          if (importedData.settings.googleModel) setGoogleModel(importedData.settings.googleModel);
        }
        await syncToDb({
          assets: importedData.assets || assets,
          fundHoldings: importedData.fundHoldings || fundHoldings,
          settings: importedData.settings || {}
        });
        setRestoreStatus({ message: 'Successfully restored portfolio from MongoDB backup!', isError: false });
        setTimeout(() => setRestoreStatus(null), 3000);
      } else {
        setRestoreStatus({ message: 'No backup found or failed to restore: ' + (data.error || 'Unknown error'), isError: true });
        setTimeout(() => setRestoreStatus(null), 3000);
      }
    } catch (e) {
      setRestoreStatus({ message: 'Error restoring from backup: ' + e, isError: true });
      setTimeout(() => setRestoreStatus(null), 3000);
    }
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        
        if (importedData.assets) {
          setAssets(importedData.assets);
        }
        if (importedData.fundHoldings) {
          setFundHoldings(importedData.fundHoldings);
        }
        if (importedData.settings) {
          if (importedData.settings.idealAllocation) setIdealAllocation(importedData.settings.idealAllocation);
          if (importedData.settings.searchSource) setSearchSource(normalizeSearchSource(importedData.settings.searchSource));
          if (importedData.settings.aiProvider) setAiProvider(importedData.settings.aiProvider);
          if (importedData.settings.openrouterModel) setSelectedModel(importedData.settings.openrouterModel);
          if (importedData.settings.googleModel) setGoogleModel(importedData.settings.googleModel);
        }

        // Sync to DB
        await syncToDb({
          assets: importedData.assets || assets,
          fundHoldings: importedData.fundHoldings || fundHoldings,
          settings: {
            idealAllocation: importedData.settings?.idealAllocation || idealAllocation,
            searchSource: importedData.settings?.searchSource
              ? normalizeSearchSource(importedData.settings.searchSource)
              : searchSource,
            aiProvider: importedData.settings?.aiProvider || aiProvider,
            openrouterModel: importedData.settings?.openrouterModel || selectedModel,
            googleModel: importedData.settings?.googleModel || googleModel
          }
        });
        
        alert('Data imported successfully!');
      } catch (err) {
        console.error('Error importing data:', err);
        alert('Failed to import data. Please ensure the file is a valid backup JSON.');
      }
    };
    reader.readAsText(file);
    // Reset file input
    e.target.value = '';
  };

  const saveOpenRouterKey = (key: string) => {
    setOpenRouterKey(key);
    syncToDb({ settings: { openRouterKey: key } });
    setIsSettingsOpen(false);
  };


  const forceRefreshHoldings = () => {
    const newHoldings = { ...fundHoldings };
    let changed = false;
    assets.forEach(asset => {
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
    if (changed) {
      setFundHoldings(newHoldings);
    }
  };

  useEffect(() => {

    if (!isAuthReady || !user) return;

    let isMounted = true;

    const loadData = async () => {
      try {
        // 1. Fetch Primary Data from MongoDB
        const res = await fetch(`/api/sync?uid=${user.uid}`);
        const json = await res.json();
        
        let data: any = null;
        
        if (json.success && json.data) {
          data = json.data;
        } else {
          // 2. Fallback to Firebase if Mongo is empty/offline
          const userRef = doc(db, 'users', user.uid);
          const docSnap = await getDoc(userRef);
          if (docSnap.exists()) {
            data = docSnap.data();
            // Sync it back into Mongo immediately so we have a backup
            await fetch('/api/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uid: user.uid, email: user.email, displayName: user.displayName, data })
            });
          }
        }

        if (!isMounted) return;

        // 2b. If neither source has data, initialize new user
        if (!data) {
          const initialData = {
            uid: user.uid,
            assets: [],
            fundHoldings: {},
            settings: {}
          };
          // Initialize in Firebase
          const userRef = doc(db, 'users', user.uid);
          await setDoc(userRef, initialData);
          // Initialize in MongoDB
          await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: user.uid, email: user.email, displayName: user.displayName, data: initialData })
          });
          return;
        }

        // 3. Apply Data to State
        if (data.assets) setAssets(data.assets);
        if (data.fundHoldings) setFundHoldings(data.fundHoldings);
        if (data.cachedCrypto) setCachedCrypto(data.cachedCrypto);
        
        if (data.settings) {
          if (data.settings.idealAllocation) {
            let loadedAllocation = { ...data.settings.idealAllocation };
            let needsSync = false;

            if (loadedAllocation['Mutual Funds'] !== undefined) {
              const mfAlloc = loadedAllocation['Mutual Funds'];
              delete loadedAllocation['Mutual Funds'];
              loadedAllocation['Equities'] = (loadedAllocation['Equities'] || 0) + Math.round(mfAlloc * 0.7);
              loadedAllocation['Fixed Income'] = (loadedAllocation['Fixed Income'] || 0) + Math.round(mfAlloc * 0.3);
              needsSync = true;
            }
            if (loadedAllocation['Mutual Fund - Equity'] !== undefined) {
              loadedAllocation['Equities'] = (loadedAllocation['Equities'] || 0) + loadedAllocation['Mutual Fund - Equity'];
              delete loadedAllocation['Mutual Fund - Equity'];
              needsSync = true;
            }
            if (loadedAllocation['Mutual Fund - Debt'] !== undefined) {
              loadedAllocation['Fixed Income'] = (loadedAllocation['Fixed Income'] || 0) + loadedAllocation['Mutual Fund - Debt'];
              delete loadedAllocation['Mutual Fund - Debt'];
              needsSync = true;
            }
            if (loadedAllocation['Debt'] !== undefined) {
              loadedAllocation['Fixed Income'] = (loadedAllocation['Fixed Income'] || 0) + loadedAllocation['Debt'];
              delete loadedAllocation['Debt'];
              needsSync = true;
            }
            if (loadedAllocation['Debt and Fixed'] !== undefined) {
              loadedAllocation['Fixed Income'] = (loadedAllocation['Fixed Income'] || 0) + loadedAllocation['Debt and Fixed'];
              delete loadedAllocation['Debt and Fixed'];
              needsSync = true;
            }
            if (loadedAllocation['Domestic Equity'] !== undefined) {
              const val = loadedAllocation['Domestic Equity'];
              delete loadedAllocation['Domestic Equity'];
              loadedAllocation['Equities > Domestic Equity'] = val;
              needsSync = true;
            }
            if (loadedAllocation['Global Equity'] !== undefined) {
              const val = loadedAllocation['Global Equity'];
              delete loadedAllocation['Global Equity'];
              loadedAllocation['Equities > Global Equity'] = val;
              needsSync = true;
            }
            if (loadedAllocation['Gold'] !== undefined) {
              const val = loadedAllocation['Gold'];
              delete loadedAllocation['Gold'];
              loadedAllocation['Commodities > Gold'] = val;
              needsSync = true;
            }
            if (loadedAllocation['Silver'] !== undefined) {
              const val = loadedAllocation['Silver'];
              delete loadedAllocation['Silver'];
              loadedAllocation['Commodities > Silver'] = val;
              needsSync = true;
            }

            if (needsSync) {
              syncToDb({ settings: { idealAllocation: loadedAllocation } });
            }
            setIdealAllocation(loadedAllocation);
          }
          if (data.settings.searchSource) {
            const normalizedSource = normalizeSearchSource(data.settings.searchSource);
            setSearchSource(normalizedSource);
            if (normalizedSource !== data.settings.searchSource) {
              syncToDb({ settings: { searchSource: normalizedSource } });
            }
          }
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
        console.error("Failed to load portfolio data:", err);
      }
    };

    loadData();

    return () => { isMounted = false; };
  }, [user, isAuthReady]);

  useEffect(() => {
    // Fetch available free models
    fetch('/api/models')
      .then(async res => {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch (e) {
          console.error('Failed to parse models data:', text.substring(0, 100));
          return null;
        }
      })
      .then(data => {
        if (data && data.data) {
          const freeModels = data.data.filter((m: any) => 
            m.pricing && 
            m.pricing.prompt === "0" && 
            m.pricing.completion === "0" &&
            m.supported_parameters?.includes('tools')
          );
          setAvailableModels(freeModels);
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    assets.forEach(asset => {
      const existing = fundHoldings[asset.symbol];
      const hasStaleFields = existing?.assetAllocation && !('stockPosition' in existing.assetAllocation);
      const missingMarketCap = existing && !('marketCapWeightage' in existing);
      const hasValidSectors = hasValidSectorWeights(existing?.sectorWeightings);
      
      const type = String(asset.type || '').toUpperCase();
      const nameLower = String(asset.name || '').toLowerCase();
      const symLower = String(asset.symbol || '').toLowerCase();
      const isLikelyETF = type === 'ETF' || nameLower.includes('etf') || nameLower.includes('bees') || symLower.includes('bees') || symLower === 'alpha.ns' || symLower === 'alpha.bo';
      const isFund = type === 'MUTUALFUND' || isLikelyETF;

      // Only refresh sector data when it is missing/invalid and a previous
      // attempt has not already confirmed that the provider has none. The old
      // blanket schema bump replaced rich cached holdings with top-10-only
      // responses from the fallback provider.
      const looksEquityFund =
        Number(existing?.assetAllocation?.stockPosition) > 0 ||
        /(equity|index|flexi|multi|large|mid|small|elss|value|momentum|alpha|nifty|sensex|bees|etf)/.test(
          `${asset.name || ''} ${existing?.categoryName || ''}`.toLowerCase(),
        );
      const needsSectorRefresh =
        Boolean(existing) &&
        looksEquityFund &&
        !hasValidSectors &&
        !existing?.sectorRefreshAttempted;

      // Compositions change slowly, but never refreshing them leaves stale
      // sector/holding data indefinitely. Seed data from before timestamps
      // existed is treated as stale once, then refreshed weekly.
      const fundLastUpdated = Number(existing?.lastUpdated) || 0;
      const isFundDataStale =
        fundLastUpdated > 0
          ? Date.now() - fundLastUpdated > 7 * 24 * 60 * 60 * 1000
          : Boolean(existing);

      const needsFetch = isFund && 
        (!existing || hasStaleFields || missingMarketCap || needsSectorRefresh || isFundDataStale) && 
        !loadingHoldings.current[asset.symbol];
        
      if (needsFetch) {
        loadingHoldings.current[asset.symbol] = true;
        fetch(`/api/holdings?symbol=${encodeURIComponent(asset.symbol)}&name=${encodeURIComponent(asset.name || '')}`)
          .then(async res => {
            const contentType = res.headers.get('content-type');
            const text = await res.text();
            
            if (!res.ok || (contentType && !contentType.includes('application/json'))) {
               // Only log error if it doesn't look like the "Starting Server..." page
               if (!text.includes('Starting Server')) {
                 console.error(`Failed to fetch holdings for ${asset.symbol}:`, text.substring(0, 100));
               }
               throw new Error(`Failed to fetch holdings: ${res.status}`);
            }
            
            return JSON.parse(text);
          })
          .then(data => {
            const hasAllocation = data?.assetAllocation &&
              Object.values(data.assetAllocation).some((value: any) => Number(value) > 0);
            const hasSectors = Array.isArray(data?.sectorWeightings) && data.sectorWeightings.length > 0;
            const hasHoldings = Array.isArray(data?.holdings) && data.holdings.length > 0;

            // Sector and allocation data are useful on their own. Requiring a
            // holdings list used to discard valid look-through data for funds
            // whose provider returned only a sector split. A response with no
            // useful fields is still merged so the retry marker is persisted.
            if (data && !data.error && (hasHoldings || hasSectors || hasAllocation || existing)) {
              setFundHoldings(prev => {
                const merged = mergeFundHoldings(prev[asset.symbol] || existing, data);
                const newHoldings = { ...prev, [asset.symbol]: merged };
                syncToDb({ fundHoldings: newHoldings });
                return newHoldings;
              });
              setHoldingsErrors(prev => {
                const newErrors = { ...prev };
                delete newErrors[asset.symbol];
                return newErrors;
              });
            } else {
              throw new Error('No holdings data returned');
            }
          })
          .catch(err => {
            console.error(`Error fetching holdings for ${asset.symbol}:`, err);
            setHoldingsErrors(prev => ({
              ...prev,
              [asset.symbol]: 'Failed to load holdings'
            }));
          })
          .finally(() => {
            loadingHoldings.current[asset.symbol] = false;
          });
      }
    });
  }, [assets, fundHoldings]);

  return {
    assets, setAssets,
    fundHoldings, setFundHoldings,
    cachedCrypto, setCachedCrypto,
    holdingsErrors, setHoldingsErrors,
    loadingHoldings,
    idealAllocation, setIdealAllocation,
    openRouterKey, setOpenRouterKey,
    isSettingsOpen, setIsSettingsOpen,
    restoreStatus, setRestoreStatus,
    aiProvider, setAiProvider,
    searchSource, setSearchSource,
    availableModels,
    selectedModel, setSelectedModel,
    googleModel, setGoogleModel,
    syncToDb,
    handleExportData,
    handleRestoreFromMongo,
    handleImportData,
    saveOpenRouterKey,
    forceRefreshHoldings,
  };
}
