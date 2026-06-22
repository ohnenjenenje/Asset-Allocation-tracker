import { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react';
import { User } from 'firebase/auth';
import { doc, setDoc, updateDoc, onSnapshot, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '@/lib/firebase';
import { Asset, PriceData } from '@/lib/types';

export function usePortfolioData(
  user: User | null,
  isAuthReady: boolean
) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [fundHoldings, setFundHoldings] = useState<Record<string, any>>({});
  const [holdingsErrors, setHoldingsErrors] = useState<Record<string, string>>({});
  const loadingHoldings = useRef<Record<string, boolean>>({});

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
  const [searchSource, setSearchSource] = useState<'indianapi' | 'yahoo' | 'newapi' | 'tickertape'>('tickertape');
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

    try {
      const userRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userRef);
      
      const firestoreUpdates: any = {};
      const cleanUpdates = removeUndefined(updates);
      
      if (cleanUpdates.assets !== undefined) firestoreUpdates.assets = cleanUpdates.assets;
      if (cleanUpdates.fundHoldings !== undefined) firestoreUpdates.fundHoldings = cleanUpdates.fundHoldings;
      if (cleanUpdates.settings) {
        for (const [key, value] of Object.entries(cleanUpdates.settings)) {
          firestoreUpdates[`settings.${key}`] = value;
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

      // Sync to MongoDB backup
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout for backup sync

        fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            data: updates
          }),
          signal: controller.signal
        }).then(res => {
          clearTimeout(timeoutId);
          if (!res.ok && res.status !== 503) { // 503 means purposefully disabled
            console.warn('MongoDB backup sync returned status:', res.status);
          }
        }).catch(err => {
          clearTimeout(timeoutId);
          // Only log the error if it's not a deliberate abort or common network issue when starting up
          if (err.name !== 'AbortError') {
            console.debug('Optional MongoDB backup sync skipped:', err.message);
          }
        });
      } catch (e) {
        // Ignore errors in the synchronous part of the backup sync setup
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
          if (importedData.settings.searchSource) setSearchSource(importedData.settings.searchSource);
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
          if (importedData.settings.searchSource) setSearchSource(importedData.settings.searchSource);
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
            searchSource: importedData.settings?.searchSource || searchSource,
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

        if (!data || !isMounted) return;

        // 3. Apply Data to State
        if (data.assets) setAssets(data.assets);
        if (data.fundHoldings) setFundHoldings(data.fundHoldings);
        
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
      
      const type = String(asset.type || '').toUpperCase();
      const nameLower = String(asset.name || '').toLowerCase();
      const symLower = String(asset.symbol || '').toLowerCase();
      const isLikelyETF = type === 'ETF' || nameLower.includes('etf') || nameLower.includes('bees') || symLower.includes('bees') || symLower === 'alpha.ns' || symLower === 'alpha.bo';
      const isFund = type === 'MUTUALFUND' || isLikelyETF;

      const needsFetch = isFund && 
        (!existing || hasStaleFields || missingMarketCap) && 
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
            if (data && data.holdings && data.holdings.length > 0) {
              setFundHoldings(prev => {
                const newHoldings = { ...prev, [asset.symbol]: data };
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
