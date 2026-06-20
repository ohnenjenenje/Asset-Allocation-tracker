'use client';

import { useState, useEffect, useCallback, useRef, Fragment, useMemo } from 'react';
import { Plus, Search, Trash2, RefreshCw, TrendingUp, TrendingDown, DollarSign, PieChart as PieChartIcon, BarChart3, List, MessageCircle, Settings, Target, X, Send, Bot, ArrowUp, ArrowDown, ArrowUpDown, MessageSquarePlus, ChevronUp, ChevronDown, ChevronRight, Pencil, Info, LogOut, Filter } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, Treemap, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { auth, db, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, logOut, handleFirestoreError, OperationType } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, updateDoc, onSnapshot, getDoc } from 'firebase/firestore';
import Screener from '@/components/Screener';

import LoginPage from '@/components/auth/LoginPage';
import AddAssetModal from '@/components/modals/AddAssetModal';
import SettingsModal from '@/components/modals/SettingsModal';
import AllocationSettingsModal from '@/components/modals/AllocationSettingsModal';
import ManualSectorModal from '@/components/modals/ManualSectorModal';
import ManualFundModal from '@/components/modals/ManualFundModal';
import DeleteConfirmModal from '@/components/modals/DeleteConfirmModal';

import { Asset, PriceData, ChatMessage } from '@/lib/types';
import { COLORS } from '@/lib/constants';
import { guessCurrency, getConvertedPrice, normalizeCategory, getCommoditySubCategory, getCapCategory, normalizeGroup, formatCompact, getBaseCryptoSymbol, isSameCrypto } from '@/lib/portfolio-utils';
import { calculateTax, formatHoldingPeriod } from '@/lib/tax-utils';
import { useAuth } from '@/hooks/useAuth';
import { usePrices } from '@/hooks/usePrices';
import { usePortfolioData } from '@/hooks/usePortfolioData';
import { useAiChat } from '@/hooks/useAiChat';
import { usePortfolioCalculations } from '@/hooks/usePortfolioCalculations';






const CustomTreemapContent = (props: any) => {
  const { x, y, width, height, index, colors, name, depth, value, totalValue } = props;

  // Assign colors based on market cap category (depth 1)
  const getBaseColor = (name: string) => {
    if (name === 'Large Cap') return '#3b82f6'; // blue-500
    if (name === 'Mid Cap') return '#10b981'; // emerald-500
    if (name === 'Small Cap') return '#8b5cf6'; // purple-500
    if (name === 'Flexi Cap') return '#f59e0b'; // amber-500
    if (name === 'Multi Cap') return '#f43f5e'; // rose-500
    if (name === 'ELSS') return '#0ea5e9'; // sky-500
    return '#94a3b8'; // slate-400
  };

  const baseColor = depth === 1 ? getBaseColor(name) : getBaseColor(props.root?.name || '');
  
  // Calculate percentage relative to the total portfolio value
  const percent = (totalValue && value) ? ((value / totalValue) * 100).toFixed(1) : '0.0';
  
  // Compact value formatter

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={Math.max(0, width || 0)}
        height={Math.max(0, height || 0)}
        style={{
          fill: baseColor,
          fillOpacity: depth === 1 ? 0.15 : 0.85,
          stroke: '#ffffff',
          strokeWidth: depth === 1 ? 3 : 1.5,
          strokeOpacity: 1,
        }}
      />
      {depth === 1 && width > 50 && height > 20 && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          fill={baseColor}
          className="font-bold text-[12px] uppercase tracking-widest opacity-40"
          style={{ pointerEvents: 'none' }}
        >
          {name}
        </text>
      )}
      {depth === 2 && width > 45 && height > 25 && (
        <text
          x={x + 6}
          y={y + 18}
          fill="#ffffff"
          fontSize={12}
          fontWeight="600"
          style={{ pointerEvents: 'none', textShadow: '0px 1px 2px rgba(0,0,0,0.4)' }}
        >
          {name}
        </text>
      )}
      {depth === 2 && width > 55 && height > 40 && (
        <text
          x={x + 6}
          y={y + 34}
          fill="#ffffff"
          fontSize={11}
          fontWeight="500"
          className="opacity-90"
          style={{ pointerEvents: 'none', textShadow: '0px 1px 2px rgba(0,0,0,0.4)' }}
        >
          {formatCompact(value)} ({percent}%)
        </text>
      )}
    </g>
  );
};

const PriceStatusIndicator = ({ lastUpdated, isFetching, symbol }: { lastUpdated?: number, isFetching: boolean, symbol: string }) => {
  if (isFetching) return (
    <div className="flex items-center gap-1 text-[10px] text-blue-500 font-medium">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      <span>Updating...</span>
    </div>
  );
  if (!lastUpdated) return (
    <div className="flex items-center gap-1 text-[10px] text-zinc-400 font-medium">
      <div className="w-1.5 h-1.5 rounded-full bg-zinc-300" />
      <span>New</span>
    </div>
  );
  
  const isFresh = Date.now() - lastUpdated < 5 * 60 * 1000;
  return (
    <div className={`flex items-center gap-1 text-[10px] font-medium ${isFresh ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
      <div className={`w-1.5 h-1.5 rounded-full ${isFresh ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      <span>{isFresh ? 'Live' : 'Old'}</span>
    </div>
  );
};

export default function Dashboard() {
  const [binanceAssets, setBinanceAssets] = useState<Asset[]>([]);
  const [coindcxAssets, setCoindcxAssets] = useState<Asset[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'portfolio' | 'screener'>('portfolio');
  const [isAllocationSettingsOpen, setIsAllocationSettingsOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({ 'Total Portfolio': true });
  const [expandedTableCategories, setExpandedTableCategories] = useState<Record<string, boolean>>({});
  const [expandedSymbols, setExpandedSymbols] = useState<Record<string, boolean>>({});
  const [expandedSectors, setExpandedSectors] = useState<Record<string, boolean>>({});
  const [expandedMarketCaps, setExpandedMarketCaps] = useState<Record<string, boolean>>({});
  const [expandedFunds, setExpandedFunds] = useState<Record<string, boolean>>({});
  const [expandedAllocCategories, setExpandedAllocCategories] = useState<Record<string, boolean>>({});
  const [manualFundModal, setManualFundModal] = useState<{ isOpen: boolean, symbol: string, name: string, holdings: { name: string, holdingPercent: number }[] } | null>(null);
  const [manualSectorModal, setManualSectorModal] = useState<{ isOpen: boolean, symbol: string, name: string, sectors: { sector: string, percentage: number }[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedResult, setSelectedResult] = useState<any | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({ key: 'currentValue', direction: 'desc' });
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [investedValueInput, setInvestedValueInput] = useState('');
  const [entryCurrency, setEntryCurrency] = useState('INR');
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);
  const [manualPrice, setManualPrice] = useState('');
  const [manualSector, setManualSector] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [availableModels, setAvailableModels] = useState<any[]>([]);

  const {
    user, isAuthReady, isSigningIn, isEmailLoginMode, isResetMode,
    emailAuthInput, passwordAuthInput, authError,
    setIsEmailLoginMode, setIsResetMode, setEmailAuthInput, setPasswordAuthInput, setAuthError,
    handleSignIn, handleEmailAuth, handleResetPassword
  } = useAuth();

  const {
    assets, setAssets,
    fundHoldings, setFundHoldings, holdingsErrors, setHoldingsErrors, loadingHoldings,
    idealAllocation, setIdealAllocation,
    openRouterKey, setOpenRouterKey,
    searchSource, setSearchSource,
    aiProvider, setAiProvider,
    selectedModel, setSelectedModel,
    googleModel, setGoogleModel,
    isSettingsOpen, setIsSettingsOpen,
    restoreStatus, syncToDb,
    handleExportData, handleImportData, handleRestoreFromMongo, forceRefreshHoldings
  } = usePortfolioData(user, isAuthReady);

  const { prices, setPrices, isLoadingPrices, priceProgress, fetchPrices } = usePrices(assets, fundHoldings);

  const mergedAssets = useMemo(() => [...assets, ...binanceAssets, ...coindcxAssets], [assets, binanceAssets, coindcxAssets]);


  const {
    portfolioStats, totalProfitLoss, totalProfitLossPercent,
    allocationData, totalCurrentValue, allocationAnalysis,
    underlyingExposure, marketCapAllocation, sectorAllocation, fundAllocation,
    treemapData, stackedBarData, allSectors, topUnderlying,
    marketCapData, sectorData, fundData, allCategories,
    consolidatedAllocation, totalAllocationValue, usdToInr, isSmallCrypto,
    CustomXAxisTick
  } = usePortfolioCalculations({ mergedAssets, assets, prices, fundHoldings, idealAllocation });

  const groupedAllocationData = useMemo(() => {
    const groups: Record<string, { name: string; value: number; constituents: { name: string; symbol: string; value: number }[] }> = {};
    
    allocationData.forEach(item => {
      const parentName = item.name.includes(' > ') ? item.name.split(' > ')[0].trim() : item.name.trim();
      if (!groups[parentName]) {
        groups[parentName] = {
          name: parentName,
          value: 0,
          constituents: []
        };
      }
      groups[parentName].value += item.value;
      if (item.constituents) {
        item.constituents.forEach((c: any) => {
          const existing = groups[parentName].constituents.find(gc => gc.symbol === c.symbol);
          if (existing) {
            existing.value += c.value;
          } else {
            groups[parentName].constituents.push({ ...c });
          }
        });
      }
    });
    
    return Object.values(groups).sort((a, b) => b.value - a.value);
  }, [allocationData]);

  const {
    isChatOpen, setIsChatOpen, chatMessages, setChatMessages,
    aiInput, setAiInput, isAiTyping, messagesEndRef, chatContainerRef,
    scrollToBottom, scrollToTop, startNewChat, handleAiCommand
  } = useAiChat({
    assets, setAssets, fundHoldings, setFundHoldings, prices, fetchPrices, syncToDb,
    openRouterKey, aiProvider, selectedModel, googleModel, availableModels, searchSource,
    setIsAddModalOpen, setIsSettingsOpen
  });

  const getRunningOperations = () => {
    const operations: string[] = [];
    if (isLoadingPrices) {
      const progress = priceProgress ? ` (${priceProgress.done}/${priceProgress.total})` : '';
      operations.push(`Updating Prices${progress}`);
    }
    if (isAiTyping) operations.push('AI Thinking');
    const loadingHoldingsValues = Object.values(loadingHoldings.current);
    if (loadingHoldingsValues.some(v => v)) operations.push('Loading Holdings');
    return operations;
  };
  const runningOperations = getRunningOperations();


  useEffect(() => {
    if (!isAuthReady || !user) return;
    
    // Helper to generic exchange fetch
    const fetchExchange = async (url: string, setter: (assets: Asset[]) => void, exchangeName: string) => {
      try {
        const res = await fetch(url);
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error(`${exchangeName} fetch error:\nUnexpected token '<', "${text.substring(0, 15)}"... is not valid JSON`);
          return;
        }

        if (Array.isArray(data)) {
          setter(data.map((a: any) => ({
            ...a,
            id: `${exchangeName.toLowerCase()}-${a.name}`,
            entryPrice: 0,
            currency: 'USD'
          })));

          setPrices(prev => {
            const newPrices = { ...prev };
            data.forEach((crypto: any) => {
              if (crypto.currentPrice) {
                newPrices[crypto.symbol] = {
                  symbol: crypto.symbol,
                  regularMarketPrice: crypto.currentPrice,
                  currency: 'USD',
                  shortName: crypto.name,
                  quoteType: 'CRYPTO',
                  source: `${exchangeName} API`,
                  lastUpdated: Date.now()
                };
              }
            });
            return newPrices;
          });
        } else {
          console.error(`Failed to fetch ${exchangeName} assets:`, data?.error || 'Unknown format');
        }
      } catch (err) {
        console.error(`${exchangeName} fetch error:`, err);
      }
    };

    fetchExchange('/api/crypto/binance', setBinanceAssets, 'Binance');
    fetchExchange('/api/crypto/coindcx', setCoindcxAssets, 'CoinDCX');
  }, [user, isAuthReady]);

  useEffect(() => {
    if (!isAuthReady || !user) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, async (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
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
      } else {
        // Initialize empty document if it doesn't exist
        try {
          const initialData = {
            uid: user.uid,
            assets: [],
            fundHoldings: {},
            settings: {}
          };
          
          await setDoc(userRef, initialData);
          
          // Sync back to Mongo under new UID
          await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              data: initialData
            })
          });
        } catch (e) {
          console.error("Initialization failed", e);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
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
    if (assets.length > 0) {
      fetchPrices();
      
      const interval = setInterval(() => {
        fetchPrices(true);
      }, 60000); // Fetch every minute
      
      return () => clearInterval(interval);
    }
  }, [assets, fetchPrices]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(async () => {
      if (searchQuery.length > 1 && !selectedResult) {
        setIsSearching(true);
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&source=${searchSource}`);
          let data;
          const text = await res.text();
          try {
            data = JSON.parse(text);
          } catch (e) {
            console.error('Failed to parse search data:', text.substring(0, 100));
            return;
          }
          if (res.ok && Array.isArray(data)) {
            setSearchResults(data);
          } else {
            setSearchResults([]);
          }
        } catch (error) {
          console.error('Search failed', error);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, selectedResult]);

  useEffect(() => {
    if (selectedResult && !editingAssetId) {
      const guessed = guessCurrency(selectedResult.symbol);
      setEntryCurrency(guessed);
    }
  }, [selectedResult, editingAssetId]);

  const handleAddAsset = () => {
    if (!selectedResult || !quantity || !entryPrice) return;

    let newAssets;
    if (editingAssetId) {
      newAssets = assets.map(a => a.id === editingAssetId ? {
        ...a,
        quantity: parseFloat(quantity),
        entryPrice: parseFloat(entryPrice),
        manualPrice: manualPrice ? parseFloat(manualPrice) : undefined,
        manualSector: manualSector || undefined,
        currency: entryCurrency,
      } : a);
    } else {
      const newAsset: Asset = {
        id: uuidv4(),
        symbol: selectedResult.symbol,
        name: selectedResult.shortname || selectedResult.longname || selectedResult.symbol,
        quantity: parseFloat(quantity),
        entryPrice: parseFloat(entryPrice),
        manualPrice: manualPrice ? parseFloat(manualPrice) : undefined,
        manualSector: manualSector || undefined,
        currency: entryCurrency,
        type: selectedResult.quoteType || 'UNKNOWN',
      };
      newAssets = [...assets, newAsset];
    }

    setAssets(newAssets);
    syncToDb({ assets: newAssets });
    
    setIsAddModalOpen(false);
    resetForm();
  };


  const isSameCrypto = (symbol1: string, symbol2: string, type1: string, type2?: string) => {
    const isCrypto1 = type1 === 'CRYPTOCURRENCY' || type1 === 'CRYPTO';
    const isCrypto2 = type2 === 'CRYPTOCURRENCY' || type2 === 'CRYPTO' || (!type2 && (symbol2.includes('-USD') || symbol2.includes('-INR')));
    
    if (!isCrypto1 && !isCrypto2) return false;
    
    const base1 = getBaseCryptoSymbol(symbol1);
    const base2 = getBaseCryptoSymbol(symbol2);
    
    return base1 === base2 && base1 !== symbol1 && base2 !== symbol2;
  };

  const findExistingAssetToMerge = (selectedRes: any) => {
    if (!selectedRes) return undefined;
    return assets.find(a => 
      a.symbol === selectedRes.symbol || 
      isSameCrypto(a.symbol, selectedRes.symbol, a.type, selectedRes.quoteType || selectedRes.type)
    );
  };

  const handleMergeAsset = () => {
    if (!selectedResult || !quantity || !entryPrice) return;
    
    const existing = findExistingAssetToMerge(selectedResult);
    if (!existing) return;

    const newQty = parseFloat(quantity);
    const newPrice = parseFloat(entryPrice);
    
    // Convert both to INR for averaging
    const existingEntryPriceInInr = getConvertedPrice(existing.entryPrice, existing.currency || guessCurrency(existing.symbol), usdToInr);
    const newEntryPriceInInr = getConvertedPrice(newPrice, entryCurrency, usdToInr);
    
    const totalQty = existing.quantity + newQty;
    const avgPriceInInr = (existing.quantity * existingEntryPriceInInr + newQty * newEntryPriceInInr) / totalQty;

    // Store in INR to be safe, or keep existing currency if they match
    const finalCurrency = (existing.currency === entryCurrency) ? existing.currency : 'INR';
    const finalPrice = (existing.currency === entryCurrency) ? 
      (existing.quantity * existing.entryPrice + newQty * newPrice) / totalQty : 
      avgPriceInInr;

    const newAssets = assets.map(a => a.id === existing.id ? {
      ...a,
      quantity: totalQty,
      entryPrice: finalPrice,
      manualPrice: manualPrice ? parseFloat(manualPrice) : a.manualPrice,
      manualSector: manualSector || a.manualSector,
      currency: finalCurrency,
    } : a);

    setAssets(newAssets);
    syncToDb({ assets: newAssets });
    
    setIsAddModalOpen(false);
    resetForm();
  };

  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        if (prev.direction === 'desc') return { key, direction: 'asc' };
        if (prev.direction === 'asc') return { key: '', direction: null };
      }
      return { key, direction: 'desc' };
    });
  };



  const renderAssets = useMemo(() => {
    // 1. Group assets by Category and Ticker
    const groups: Record<string, Asset[]> = {};
    mergedAssets.forEach(asset => {
      const cat = normalizeCategory(asset.type);
      const groupKey = `${cat}-${asset.symbol}`;
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push(asset);
    });

    // 2. Create aggregated rows or individual assets
    const aggregated: (Asset & { isGroup?: boolean; subItems?: Asset[] })[] = [];
    Object.values(groups).forEach(items => {
      if (items.length > 1) {
        const first = items[0];
        const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
        
        // Calculate weighted avg entry price
        let totalInvested = 0;
        items.forEach(item => {
          const assetCurrency = item.currency || guessCurrency(item.symbol);
          const entryPrice = getConvertedPrice(item.entryPrice, assetCurrency, usdToInr);
          totalInvested += entryPrice * item.quantity;
        });
        const weightedEntryPrice = totalInvested / totalQty;

        aggregated.push({
          ...first,
          id: `group-${first.symbol}`,
          quantity: totalQty,
          entryPrice: weightedEntryPrice, // Weighted average in INR
          currency: 'INR',
          isGroup: true,
          subItems: items.sort((a, b) => b.quantity - a.quantity)
        });
      } else {
        aggregated.push(items[0]);
      }
    });

    // 3. Sort aggregated list using the same strategy as sortedAssets
    return aggregated.sort((a, b) => {
      const getCategoryPriority = (asset: Asset) => {
        const cat = normalizeCategory(asset.type);
        if (cat === 'Equities' || cat === 'EQUITY' || cat === 'STOCK') return 1;
        if (cat === 'Mutual Funds' || cat === 'MUTUALFUND' || cat === 'ETF') return 2;
        if (cat === 'Fixed Income' || cat === 'DEBT' || cat === 'FIXED INCOME') return 3;
        if (cat === 'Cash' || cat === 'CASH') return 4;
        if (cat === 'Crypto' || cat === 'CRYPTOCURRENCY') return 5;
        return 6; 
      };

      const priorityA = getCategoryPriority(a);
      const priorityB = getCategoryPriority(b);

      if (priorityA !== priorityB) return priorityA - priorityB;

      if (priorityA === 5) {
        const aSmall = isSmallCrypto(a);
        const bSmall = isSmallCrypto(b);
        if (aSmall !== bSmall) return aSmall ? 1 : -1;
      }

      if (!sortConfig.key || !sortConfig.direction) return 0;

      const getVal = (asset: Asset) => {
        const priceData = prices[asset.symbol];
        const hasPrice = priceData?.regularMarketPrice != null;
        const currentPriceRaw = asset.manualPrice || (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
        
        let currentCurrency;
        if (asset.manualPrice) {
          currentCurrency = asset.currency || guessCurrency(asset.symbol);
        } else if (hasPrice) {
          currentCurrency = priceData.currency || guessCurrency(asset.symbol);
          if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
        } else {
          currentCurrency = asset.currency || guessCurrency(asset.symbol);
        }
        
        const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
        const assetCurrency = asset.currency || guessCurrency(asset.symbol);
        const entryPrice = asset.isGroup ? asset.entryPrice : getConvertedPrice(asset.entryPrice, assetCurrency, usdToInr);

        switch (sortConfig.key) {
          case 'name': return asset.name || '';
          case 'symbol': return asset.symbol || '';
          case 'quantity': return asset.quantity;
          case 'entryPrice': return entryPrice;
          case 'investedValue': return entryPrice * asset.quantity;
          case 'currentPrice': return currentPrice;
          case 'currentValue': return currentPrice * asset.quantity;
          case 'pnl': return (currentPrice * asset.quantity) - (entryPrice * asset.quantity);
          case 'pnlPercent': 
            const invested = entryPrice * asset.quantity;
            return invested > 0 ? (((currentPrice * asset.quantity) - invested) / invested) * 100 : 0;
          default: return 0;
        }
      };

      const valA = getVal(a);
      const valB = getVal(b);

      if (typeof valA === 'string' && typeof valB === 'string') {
        return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      const numA = Number(valA);
      const numB = Number(valB);
      if (numA < numB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (numA > numB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [mergedAssets, sortConfig, prices, isSmallCrypto]);

  const SortIndicator = ({ column }: { column: string }) => {
    if (sortConfig.key !== column) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-20" />;
    if (sortConfig.direction === 'asc') return <ChevronUp className="w-3 h-3 ml-1 text-blue-500" />;
    if (sortConfig.direction === 'desc') return <ChevronDown className="w-3 h-3 ml-1 text-blue-500" />;
    return <ArrowUpDown className="w-3 h-3 ml-1 opacity-20" />;
  };

  const handleDeleteAsset = (id: string) => {
    setAssetToDelete(id);
  };

  const confirmDelete = () => {
    if (assetToDelete) {
      const newAssets = assets.filter(a => a.id !== assetToDelete);
      setAssets(newAssets);
      syncToDb({ assets: newAssets });
      setAssetToDelete(null);
    }
  };

  const handleEditAsset = (asset: Asset) => {
    setEditingAssetId(asset.id);
    setSelectedResult({
      symbol: asset.symbol,
      shortname: asset.name,
      longname: asset.name,
      quoteType: asset.type
    });
    setSearchQuery(asset.name);
    setQuantity(asset.quantity.toString());
    setEntryPrice(asset.entryPrice.toString());
    if (asset.symbol === 'GOLD-INR-GRAM' || asset.symbol === 'SILVER-INR-GRAM' || asset.symbol === 'CASH-INR') {
      setInvestedValueInput((asset.entryPrice * asset.quantity).toFixed(2).toString());
    }
    setManualPrice(asset.manualPrice ? asset.manualPrice.toString() : '');
    setManualSector(asset.manualSector || '');
    setEntryCurrency(asset.currency || guessCurrency(asset.symbol));
    setIsAddModalOpen(true);
  };

  const resetForm = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResult(null);
    setQuantity('');
    setEntryPrice('');
    setInvestedValueInput('');
    setManualPrice('');
    setManualSector('');
    setPurchaseDate('');
    setEntryCurrency('INR');
    setEditingAssetId(null);
  };

  const saveOpenRouterKey = (key: string) => {
    setOpenRouterKey(key);
    syncToDb({ settings: { openRouterKey: key } });
    setIsSettingsOpen(false);
  };








  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        isResetMode={isResetMode}
        setIsResetMode={setIsResetMode}
        isEmailLoginMode={isEmailLoginMode}
        setIsEmailLoginMode={setIsEmailLoginMode}
        emailAuthInput={emailAuthInput}
        setEmailAuthInput={setEmailAuthInput}
        passwordAuthInput={passwordAuthInput}
        setPasswordAuthInput={setPasswordAuthInput}
        authError={authError}
        setAuthError={setAuthError}
        isSigningIn={isSigningIn}
        handleSignIn={handleSignIn}
        handleEmailAuth={handleEmailAuth}
        handleResetPassword={handleResetPassword}
      />
    );
  }

  const handleScreenerAdd = (ticker: string) => {
    setSearchQuery(ticker);
    setIsAddModalOpen(true);
    setActiveTab('portfolio');
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {runningOperations.length > 0 && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white text-center py-2 text-sm font-semibold shadow-md animate-in slide-in-from-top-2">
            {runningOperations.join(' | ')}...
          </div>
        )}
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Asset Allocation Tracker</h1>
            <p className="text-zinc-500 dark:text-zinc-400 mt-1">Track your investments in real-time</p>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={() => setIsAllocationSettingsOpen(true)}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Ideal Allocation Target"
            >
              <Target className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={logOut}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
            <button 
              onClick={() => { fetchPrices(true); forceRefreshHoldings(); }}
              disabled={isLoadingPrices || assets.length === 0}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              title="Refresh All Data"
            >
              <RefreshCw className={`w-5 h-5 ${isLoadingPrices ? 'animate-spin' : ''}`} />
            </button>
            <button 
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors shadow-sm"
            >
              <Plus className="w-5 h-5" />
              <span>Add Asset</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('portfolio')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'portfolio' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
          >
            <PieChartIcon className="w-4 h-4" />
            Portfolio
          </button>
          <button
            onClick={() => setActiveTab('screener')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'screener' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
          >
            <Filter className="w-4 h-4" />
            Screener
          </button>
        </div>

        {activeTab === 'portfolio' ? (
          <>
            {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-2">
              <DollarSign className="w-4 h-4" />
              <h3 className="font-medium text-sm uppercase tracking-wider">Total Value</h3>
            </div>
            <div className="text-3xl font-bold">
              ₹{portfolioStats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </div>
          </div>
          
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-2">
              <TrendingUp className="w-4 h-4" />
              <h3 className="font-medium text-sm uppercase tracking-wider">Total Invested</h3>
            </div>
            <div className="text-3xl font-bold">
              ₹{portfolioStats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </div>
          </div>

          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
            <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 mb-2">
              {totalProfitLoss >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
              <h3 className="font-medium text-sm uppercase tracking-wider">Total P&L</h3>
            </div>
            <div className={`text-3xl font-bold flex items-baseline gap-2 ${totalProfitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {totalProfitLoss >= 0 ? '+' : ''}₹{totalProfitLoss.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              <span className="text-sm font-medium opacity-80">
                ({totalProfitLoss >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Allocation Chart */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-6">
              <PieChartIcon className="w-5 h-5 text-blue-500" />
              <h2 className="text-lg font-semibold">Asset Allocation</h2>
            </div>
            {assets.length > 0 ? (
              <div className="flex flex-col flex-1">
                <div className="min-h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={allocationData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {allocationData.map((entry, index) => (
                          <Cell key={`cell-allocation-${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: any) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 flex flex-col gap-3">
                  {allocationData.map((entry, index) => {
                    const total = allocationData.reduce((sum, item) => sum + item.value, 0);
                    const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                    const isExpanded = expandedCategories[entry.name];
                    return (
                      <div 
                        key={`legend-allocation-${entry.name}-${index}`} 
                        className="flex flex-col gap-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        onClick={() => setExpandedCategories(prev => ({ ...prev, [entry.name]: !prev[entry.name] }))}
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{entry.name}</span>
                          </div>
                          <div className="font-bold text-zinc-900 dark:text-zinc-100">
                            ₹{entry.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            <span className="text-zinc-400 ml-1.5 font-normal text-xs">
                              ({percent}%)
                            </span>
                          </div>
                        </div>

                        <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden flex">
                          <div 
                            className="h-full transition-all duration-500 rounded-full" 
                            style={{ width: `${percent}%`, backgroundColor: COLORS[index % COLORS.length] }} 
                          />
                        </div>
                        
                        {isExpanded && entry.constituents && entry.constituents.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-zinc-200 dark:border-zinc-700 flex flex-col gap-1.5">
                            {[...entry.constituents].sort((a: any, b: any) => b.value - a.value).map((c: any, i: number) => {
                              const cPercent = entry.value > 0 ? ((c.value / entry.value) * 100).toFixed(1) : '0.0';
                              return (
                                <div key={`const-${i}`} className="flex justify-between items-center text-xs text-zinc-600 dark:text-zinc-400">
                                  <span className="truncate max-w-[150px]">{c.name}</span>
                                  <div className="flex items-center gap-2">
                                    <span>₹{c.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                    <span className="w-10 text-right opacity-70">{cPercent}%</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Allocation Value</span>
                  <span className="text-lg font-black text-zinc-900 dark:text-zinc-100">
                    ₹{portfolioStats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                Add assets to see allocation
              </div>
            )}
          </div>

          {/* Market Cap Chart */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-6">
              <BarChart3 className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-semibold">Market Cap Exposure</h2>
            </div>
            {marketCapData.length > 0 ? (
              <div className="flex flex-col flex-1">
                <div className="min-h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={marketCapData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {marketCapData.map((entry, index) => (
                          <Cell key={`cell-mcap-${entry.name}-${index}`} fill={COLORS[(index + 3) % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: any) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 flex flex-col gap-3">
                  {marketCapData.map((entry, index) => {
                    const total = marketCapData.reduce((sum, item) => sum + item.value, 0);
                    const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                    const directPercent = entry.value > 0 ? ((entry.direct / entry.value) * 100).toFixed(0) : '0';
                    const indirectPercent = entry.value > 0 ? ((entry.indirect / entry.value) * 100).toFixed(0) : '0';

                    return (
                      <div 
                        key={`legend-mcap-${entry.name}-${index}`} 
                        className="flex flex-col gap-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        onClick={() => setExpandedMarketCaps(prev => ({ ...prev, [entry.name]: !prev[entry.name] }))}
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[(index + 3) % COLORS.length] }} />
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{entry.name}</span>
                          </div>
                          <div className="font-bold text-zinc-900 dark:text-zinc-100">
                            ₹{entry.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                            <span className="text-zinc-400 ml-1.5 font-normal text-xs">
                              ({percent}%)
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <span>Stocks: {directPercent}% (₹{entry.direct.toLocaleString('en-IN', { maximumFractionDigits: 0 })})</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>Funds: {indirectPercent}% (₹{entry.indirect.toLocaleString('en-IN', { maximumFractionDigits: 0 })})</span>
                          </div>
                        </div>

                        <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden flex">
                          <div 
                            className="h-full bg-blue-500 transition-all duration-500" 
                            style={{ width: `${directPercent}%` }} 
                          />
                          <div 
                            className="h-full bg-emerald-500 transition-all duration-500" 
                            style={{ width: `${indirectPercent}%` }} 
                          />
                        </div>

                        {expandedMarketCaps[entry.name] && entry.constituents && entry.constituents.length > 0 && (
                          <div className="mt-2 pt-3 border-t border-zinc-200 dark:border-zinc-700 space-y-3">
                            {entry.constituents.filter((c: any) => c.type === 'direct').length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Direct Stocks:</div>
                                {entry.constituents.filter((c: any) => c.type === 'direct').sort((a: any, b: any) => b.value - a.value).map((c: any) => (
                                  <div key={c.symbol} className="flex justify-between items-center text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                                    <span className="truncate max-w-[180px]">{c.name}</span>
                                    <span className="font-medium">₹{c.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {entry.constituents.filter((c: any) => c.type === 'indirect').length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Mutual Funds / ETFs:</div>
                                {entry.constituents.filter((c: any) => c.type === 'indirect').sort((a: any, b: any) => b.value - a.value).map((c: any) => (
                                  <div key={c.symbol} className="flex flex-col mb-1">
                                    <div 
                                      className={`flex justify-between items-center text-xs ${(c.subHoldings && c.subHoldings.length > 0) || (c.otherAllocations && c.otherAllocations.length > 0) ? 'cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100' : ''} text-zinc-600 dark:text-zinc-400`}
                                      onClick={(e) => {
                                        if ((c.subHoldings && c.subHoldings.length > 0) || (c.otherAllocations && c.otherAllocations.length > 0)) {
                                          e.stopPropagation();
                                          setExpandedFunds(prev => ({ ...prev, [`${entry.name}-${c.symbol}`]: !prev[`${entry.name}-${c.symbol}`] }));
                                        }
                                      }}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="truncate max-w-[170px]">{c.name}</span>
                                        {c.subHoldings && c.subHoldings.length > 0 && (
                                          <span className="text-[9px] bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-500 dark:text-zinc-400">+{c.subHoldings.length}</span>
                                        )}
                                        {(!c.subHoldings || c.subHoldings.length === 0) && c.otherAllocations && c.otherAllocations.length > 0 && (
                                          <span className="text-[9px] bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-500 dark:text-zinc-400">Split</span>
                                        )}
                                      </div>
                                      <span className="font-medium">₹{c.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                    </div>
                                    {expandedFunds[`${entry.name}-${c.symbol}`] && (
                                      <div className="ml-2 mt-1.5 mb-1.5 pl-2.5 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-2">
                                        {c.subHoldings && c.subHoldings.length > 0 && (
                                          <div>
                                            <div className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold mb-1">Underlying Stocks in {entry.name}</div>
                                            <div className="space-y-1">
                                              {[...(c.subHoldings || [])].sort((a: any, b: any) => b.value - a.value).map((sh: any) => (
                                                <div key={sh.symbol || sh.name} className="flex justify-between items-center text-[10px] text-zinc-500 dark:text-zinc-400">
                                                  <span className="truncate max-w-[150px]">{sh.name}</span>
                                                  <span>₹{sh.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {c.otherAllocations && c.otherAllocations.length > 0 && (
                                          <div>
                                            <div className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold mb-1">Remaining Fund Allocation</div>
                                            <div className="space-y-1">
                                              {[...(c.otherAllocations || [])].sort((a: any, b: any) => b.value - a.value).map((oa: any) => (
                                                <div key={oa.name} className="flex justify-between items-center text-[10px] text-zinc-500 dark:text-zinc-400">
                                                  <span className="truncate max-w-[150px]">{oa.name}</span>
                                                  <span>₹{oa.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Market Cap Value</span>
                  <span className="text-lg font-black text-zinc-900 dark:text-zinc-100">
                    ₹{marketCapData.reduce((sum, item) => sum + item.value, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                Add equities to see market cap
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">
          {/* Sector Allocation Chart */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-6">
              <PieChartIcon className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-semibold">Sector Allocation</h2>
            </div>
            {sectorData.length > 0 ? (
              <div className="flex flex-col flex-1">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sectorData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {sectorData.map((entry, index) => (
                          <Cell key={`cell-sector-${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: any) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 space-y-4">
                  {sectorData.map((entry, index) => {
                    const total = sectorData.reduce((sum, item) => sum + item.value, 0);
                    const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                    const directPercent = entry.value > 0 ? ((entry.direct / entry.value) * 100).toFixed(0) : '0';
                    const indirectPercent = entry.value > 0 ? ((entry.indirect / entry.value) * 100).toFixed(0) : '0';

                    return (
                      <div 
                        key={`legend-sector-${entry.name}-${index}`} 
                        className="flex flex-col gap-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        onClick={() => setExpandedSectors(prev => ({ ...prev, [entry.name]: !prev[entry.name] }))}
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{entry.name}</span>
                          </div>
                        </div>
                        <div className="text-zinc-600 dark:text-zinc-400 font-medium text-sm">
                          ₹{entry.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          <span className="text-zinc-400 ml-1.5 font-normal text-xs">
                            ({percent}%)
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-3 text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <span>Stocks: {directPercent}% (₹{entry.direct.toLocaleString('en-IN', { maximumFractionDigits: 0 })})</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span>Funds: {indirectPercent}% (₹{entry.indirect.toLocaleString('en-IN', { maximumFractionDigits: 0 })})</span>
                          </div>
                        </div>

                        <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden flex">
                          <div 
                            className="h-full bg-blue-500 transition-all duration-500" 
                            style={{ width: `${directPercent}%` }} 
                          />
                          <div 
                            className="h-full bg-emerald-500 transition-all duration-500" 
                            style={{ width: `${indirectPercent}%` }} 
                          />
                        </div>

                        {expandedSectors[entry.name] && entry.constituents && entry.constituents.length > 0 && (
                          <div className="mt-2 pt-3 border-t border-zinc-200 dark:border-zinc-700 space-y-3">
                            {entry.constituents.filter((c: any) => c.type === 'direct').length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Direct Stocks:</div>
                                {entry.constituents.filter((c: any) => c.type === 'direct').sort((a: any, b: any) => b.value - a.value).map((c: any) => (
                                  <div key={c.symbol} className="flex justify-between items-center text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                                    <span className="truncate max-w-[180px]">{c.name}</span>
                                    <span className="font-medium">₹{c.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {entry.constituents.filter((c: any) => c.type === 'indirect').length > 0 && (
                              <div>
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Mutual Funds / ETFs:</div>
                                {entry.constituents.filter((c: any) => c.type === 'indirect').sort((a: any, b: any) => b.value - a.value).map((c: any) => (
                                  <div key={c.symbol} className="flex flex-col mb-1">
                                    <div 
                                      className={`flex justify-between items-center text-xs ${c.otherAllocations && c.otherAllocations.length > 0 ? 'cursor-pointer hover:text-zinc-900 dark:hover:text-zinc-100' : ''} text-zinc-600 dark:text-zinc-400`}
                                      onClick={(e) => {
                                        if (c.otherAllocations && c.otherAllocations.length > 0) {
                                          e.stopPropagation();
                                          setExpandedFunds(prev => ({ ...prev, [`sec-${entry.name}-${c.symbol}`]: !prev[`sec-${entry.name}-${c.symbol}`] }));
                                        }
                                      }}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <span className="truncate max-w-[170px]">{c.name}</span>
                                        {c.otherAllocations && c.otherAllocations.length > 0 && (
                                          <span className="text-[9px] bg-zinc-200 dark:bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-500 dark:text-zinc-400">Split</span>
                                        )}
                                      </div>
                                      <span className="font-medium">₹{c.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                    </div>
                                    {expandedFunds[`sec-${entry.name}-${c.symbol}`] && c.otherAllocations && c.otherAllocations.length > 0 && (
                                      <div className="ml-2 mt-1.5 mb-1.5 pl-2.5 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-2">
                                        <div>
                                          <div className="text-[9px] uppercase tracking-wider text-zinc-400 font-bold mb-1">Remaining Fund Allocation</div>
                                          <div className="space-y-1">
                                            {[...(c.otherAllocations || [])].sort((a: any, b: any) => b.value - a.value).map((oa: any) => (
                                              <div key={oa.name} className="flex justify-between items-center text-[10px] text-zinc-500 dark:text-zinc-400">
                                                <span className="truncate max-w-[150px]">{oa.name}</span>
                                                <span>₹{oa.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Sector Value</span>
                    <span className="text-lg font-black text-zinc-900 dark:text-zinc-100">
                      ₹{sectorData.reduce((sum, item) => sum + item.value, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                Add assets to see sector allocation
              </div>
            )}
          </div>

          {/* Mutual Fund / ETF Allocation Chart */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-6">
              <PieChartIcon className="w-5 h-5 text-purple-500" />
              <h2 className="text-lg font-semibold">Mutual Fund / ETF Allocation</h2>
            </div>
            {fundData.length > 0 ? (
              <div className="flex flex-col flex-1">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={fundData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {fundData.map((entry, index) => (
                          <Cell key={`cell-fund-${entry.name}-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: any) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 space-y-4">
                  {fundData.map((entry, index) => {
                    const total = fundData.reduce((sum, item) => sum + item.value, 0);
                    const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';

                    return (
                      <div 
                        key={`legend-fund-${entry.name}-${index}`} 
                        className="flex flex-col gap-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                        onClick={() => setExpandedFunds(prev => ({ ...prev, [entry.name]: !prev[entry.name] }))}
                      >
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-600 dark:text-zinc-400">{percent}%</span>
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                const symbol = entry.constituents[0]?.symbol;
                                if (!symbol) return;
                                setManualFundModal({ 
                                  isOpen: true, 
                                  symbol: symbol, 
                                  name: entry.name, 
                                  holdings: fundHoldings[symbol]?.holdings || [] 
                                });
                              }}
                              className="p-1.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded-lg transition-colors group"
                              title="Edit Holdings"
                            >
                              <Pencil className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300" />
                            </button>
                          </div>
                        </div>
                        <div className="text-zinc-600 dark:text-zinc-400 font-medium text-sm">
                          ₹{entry.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          <span className="text-zinc-400 ml-1.5 font-normal text-xs">
                            ({percent}%)
                          </span>
                        </div>
                        {expandedFunds[entry.name] && entry.constituents && entry.constituents.length > 0 && (
                          <div className="mt-2 pt-3 border-t border-zinc-200 dark:border-zinc-700 space-y-4">
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Underlying Holdings:</div>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const symbol = entry.constituents[0]?.symbol;
                                    if (!symbol) return;
                                    setManualFundModal({ 
                                      isOpen: true, 
                                      symbol: symbol, 
                                      name: entry.name, 
                                      holdings: fundHoldings[symbol]?.holdings || [] 
                                    });
                                  }}
                                  className="text-[10px] text-blue-500 hover:text-blue-600 font-bold uppercase tracking-wider"
                                >
                                  Edit Holdings
                                </button>
                              </div>
                              {entry.constituents.flatMap(c => c.subHoldings || []).sort((a: any, b: any) => b.value - a.value).map((sh: any) => (
                                <div key={sh.symbol || sh.name} className="flex justify-between items-center text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                                  <span className="truncate max-w-[180px]">{sh.name}</span>
                                  <span className="font-medium">₹{sh.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                              ))}
                            </div>

                            {(() => {
                              const symbol = entry.constituents[0]?.symbol;
                              const alloc = symbol ? fundHoldings[symbol]?.assetAllocation : null;
                              
                              if (!alloc) return null;
                              
                              return (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold mb-2">Asset Allocation:</div>
                                  
                                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-2">
                                    {alloc.stockPosition > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                        <span>Equity: {alloc.stockPosition.toFixed(1)}%</span>
                                      </div>
                                    )}
                                    {alloc.bondPosition > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        <span>Debt: {alloc.bondPosition.toFixed(1)}%</span>
                                      </div>
                                    )}
                                    {alloc.cashPosition > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                        <span>Cash: {alloc.cashPosition.toFixed(1)}%</span>
                                      </div>
                                    )}
                                    {alloc.otherPosition > 0 && (
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                        <span>Other: {alloc.otherPosition.toFixed(1)}%</span>
                                      </div>
                                    )}
                                  </div>

                                  <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden flex">
                                    {alloc.stockPosition > 0 && <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${alloc.stockPosition}%` }} />}
                                    {alloc.bondPosition > 0 && <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${alloc.bondPosition}%` }} />}
                                    {alloc.cashPosition > 0 && <div className="h-full bg-purple-500 transition-all duration-500" style={{ width: `${alloc.cashPosition}%` }} />}
                                    {alloc.otherPosition > 0 && <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${alloc.otherPosition}%` }} />}
                                  </div>
                                </div>
                              );
                            })()}

                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">Sector Allocation:</div>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const symbol = entry.constituents[0]?.symbol;
                                    if (!symbol) return;
                                    setManualSectorModal({ 
                                      isOpen: true, 
                                      symbol: symbol, 
                                      name: entry.name, 
                                      sectors: fundHoldings[symbol]?.sectorWeightings || [] 
                                    });
                                  }}
                                  className="text-[10px] text-blue-500 hover:text-blue-600 font-bold uppercase tracking-wider"
                                >
                                  Edit Sectors
                                </button>
                              </div>
                              {[...(fundHoldings[entry.constituents[0]?.symbol]?.sectorWeightings || [])].sort((a: any, b: any) => b.percentage - a.percentage).map((sw: any) => (
                                <div key={sw.sector} className="flex justify-between items-center text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                                  <span className="truncate max-w-[180px]">{sw.sector}</span>
                                  <span className="font-medium">{sw.percentage}%</span>
                                </div>
                              ))}
                              {(!fundHoldings[entry.constituents[0]?.symbol]?.sectorWeightings || fundHoldings[entry.constituents[0]?.symbol]?.sectorWeightings.length === 0) && (
                                <div className="text-[10px] text-zinc-400 italic">
                                  {fundHoldings[entry.constituents[0]?.symbol]?.debug ? `Data not fetched: ${fundHoldings[entry.constituents[0]?.symbol].debug}` : "No sector data available. Click edit to add."}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Fund Value</span>
                    <span className="text-lg font-black text-zinc-900 dark:text-zinc-100">
                      ₹{fundData.reduce((sum, item) => sum + item.value, 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                Add Mutual Funds or ETFs to see allocation
              </div>
            )}
          </div>

          {/* Combined Sector by Market Cap Treemap */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-6">
              <BarChart3 className="w-5 h-5 text-orange-500" />
              <h2 className="text-lg font-semibold">Sector by Market Cap (Combined)</h2>
            </div>
            {treemapData[0] && treemapData[0].children && treemapData[0].children.length > 0 ? (
              <div className="flex-1">
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <Treemap
                      data={treemapData[0].children}
                      dataKey="value"
                      aspectRatio={4 / 3}
                      stroke="#fff"
                      fill="#8884d8"
                      content={<CustomTreemapContent colors={COLORS} totalValue={sectorData.reduce((sum, item) => sum + item.value, 0)} />}
                    >
                      <RechartsTooltip 
                        formatter={(value: any, name: any) => [`₹${Number(value).toLocaleString('en-IN')}`, name]}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                    </Treemap>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 text-xs text-zinc-500 flex flex-wrap gap-4 justify-center">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-blue-500/20 border border-blue-500/40"></div>
                    <span>Large Cap</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/40"></div>
                    <span>Mid Cap</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-purple-500/20 border border-purple-500/40"></div>
                    <span>Small Cap</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-amber-500/20 border border-amber-500/40"></div>
                    <span>Flexi Cap</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-rose-500/20 border border-rose-500/40"></div>
                    <span>Multi Cap</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-sky-500/20 border border-sky-500/40"></div>
                    <span>ELSS</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                Add assets to see combined distribution
              </div>
            )}
          </div>
        </div>

        {/* Sector by Market Cap Stacked Bar Chart */}
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm mt-8">
          <div className="flex items-center gap-2 mb-6">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold">Sector Distribution across Market Caps</h2>
          </div>
          {stackedBarData.length > 0 ? (
            <div className="h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stackedBarData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" opacity={0.5} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={<CustomXAxisTick />} height={80} />
                  <YAxis 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fill: '#6b7280', fontSize: 12 }}
                    tickFormatter={(value) => `₹${(value / 100000).toFixed(0)}L`}
                    dx={-10}
                  />
                  <RechartsTooltip 
                    formatter={(value: any) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    cursor={{ fill: '#f3f4f6', opacity: 0.4 }}
                  />
                  <Legend wrapperStyle={{ paddingTop: '20px' }} iconType="circle" />
                  {allSectors.map((sector, index) => (
                    <Bar 
                      key={sector} 
                      dataKey={sector} 
                      stackId="a" 
                      fill={COLORS[index % COLORS.length]} 
                      maxBarSize={60}
                      radius={[2, 2, 2, 2]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm py-12">
              Add assets to see sector distribution
            </div>
          )}
          
          {/* Sector Breakdown Legend with Numerical Values and Color Rods */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4">
            {allSectors.map((sector, index) => {
              const totalSectorValue = stackedBarData.reduce((sum, cap) => sum + (cap[sector] || 0), 0);
              const totalPortfolioValue = stackedBarData.reduce((sum, cap) => 
                sum + Object.entries(cap).reduce((capSum, [key, val]) => key !== 'name' ? capSum + (val as number) : capSum, 0), 0);
              const percent = totalPortfolioValue > 0 ? ((totalSectorValue / totalPortfolioValue) * 100).toFixed(1) : '0.0';
              
  const formatCompact = (val: number) => {
    if (val === undefined || val === null) return '₹0';
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
    return `₹${val.toFixed(0)}`;
  };

  return (
    <div key={sector} className="flex flex-col gap-1.5 p-3 rounded-lg bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
          <span className="font-semibold text-zinc-900 dark:text-zinc-100 truncate">{sector}</span>
        </div>
        <span className="font-medium text-zinc-600 dark:text-zinc-400">
          {formatCompact(totalSectorValue)} ({percent}%)
        </span>
      </div>
      <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden flex">
        {stackedBarData.map((cap, capIdx) => {
          const capTotal = Object.entries(cap).reduce((sum, [key, val]) => key !== 'name' ? sum + (val as number) : sum, 0);
          const sectorVal = cap[sector] || 0;
          const capPercent = capTotal > 0 ? (sectorVal / capTotal) * 100 : 0;
          return (
            <div 
              key={`${cap.name}-${capIdx}`}
              className="h-full"
              title={`${cap.name}: ${formatCompact(sectorVal)}`}
              style={{ 
                width: `${capPercent}%`, 
                backgroundColor: COLORS[index % COLORS.length],
                opacity: 0.4 + (0.6 * (allSectors.indexOf(sector) / allSectors.length))
              }}
            />
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5">
        {stackedBarData.map((cap, capIdx) => {
          const sectorVal = cap[sector] || 0;
          if (sectorVal === 0) return null;
          return (
            <div key={`${cap.name}-val-${capIdx}`} className="flex justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
              <span className="truncate">{cap.name}</span>
              <span className="font-medium">{formatCompact(sectorVal)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
            })}
          </div>
        </div>

        {/* Asset Allocation Analysis */}
        {allocationAnalysis.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden mt-8">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <PieChartIcon className="w-5 h-5 text-blue-500" />
                Asset Allocation Analysis
              </h2>
              <button onClick={() => setIsAllocationSettingsOpen(true)} className="text-sm text-blue-500 hover:text-blue-600 font-medium">
                Edit Ideal Allocation
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-medium">Category</th>
                    <th className="px-6 py-4 font-medium text-right">Current Value</th>
                    <th className="px-6 py-4 font-medium text-right">Current %</th>
                    <th className="px-6 py-4 font-medium text-right">Ideal %</th>
                    <th className="px-6 py-4 font-medium text-right">Difference %</th>
                    <th className="px-6 py-4 font-medium text-right">Action Needed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {allocationAnalysis.map((item, index) => (
                    <Fragment key={`category-${item.category}-${index}`}>
                      <tr 
                        className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors ${(item.constituents && item.constituents.length > 0) || (item.subCategories && item.subCategories.length > 0) ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          if ((item.constituents && item.constituents.length > 0) || (item.subCategories && item.subCategories.length > 0)) {
                            setExpandedCategories(prev => ({ ...prev, [item.category]: !prev[item.category] }));
                          }
                        }}
                      >
                        <td className="px-6 py-4 font-medium flex items-center gap-2">
                          {((item.constituents && item.constituents.length > 0) || (item.subCategories && item.subCategories.length > 0)) && (
                            expandedCategories[item.category] ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />
                          )}
                          {item.category}
                          {item.category === 'Cash' && (
                            <div className="group relative flex items-center">
                              <Info className="w-4 h-4 text-zinc-400 cursor-help" />
                              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-zinc-800 text-xs text-zinc-100 rounded-lg shadow-xl z-10 text-center leading-relaxed">
                                Includes your direct cash holdings plus the cash portion of your mutual funds. Mutual funds hold cash for liquidity, handling redemptions, or waiting for investment opportunities.
                                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800"></div>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">₹{item.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                        <td className="px-6 py-4 text-right">{item.currentPercentage.toFixed(1)}%</td>
                        <td className="px-6 py-4 text-right">{item.idealPercentage}%</td>
                        <td className={`px-6 py-4 text-right font-medium ${item.diffPercentage > 1 ? 'text-red-500' : item.diffPercentage < -1 ? 'text-blue-500' : 'text-emerald-500'}`}>
                          {item.diffPercentage > 0 ? '+' : ''}{item.diffPercentage.toFixed(1)}%
                        </td>
                        <td className="px-6 py-4 text-right">
                          {item.diffPercentage > 2 ? (
                            <span className="text-red-500 font-medium">Reduce by ₹{Math.abs(item.diffValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                          ) : item.diffPercentage < -2 ? (
                            <span className="text-blue-500 font-medium">Invest ₹{Math.abs(item.diffValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                          ) : (
                            <span className="text-emerald-500 font-medium">On Track</span>
                          )}
                        </td>
                      </tr>
                      {expandedCategories[item.category] && item.subCategories && item.subCategories.length > 0 && (
                        item.subCategories.map((sub: any, subIndex: number) => (
                          <Fragment key={`${item.category}-${sub.category}-${subIndex}`}>
                            <tr 
                              className={`bg-zinc-50/30 dark:bg-zinc-900/10 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors ${sub.constituents && sub.constituents.length > 0 ? 'cursor-pointer' : ''}`}
                              onClick={() => {
                                if (sub.constituents && sub.constituents.length > 0) {
                                  setExpandedCategories(prev => ({ ...prev, [sub.category]: !prev[sub.category] }));
                                }
                              }}
                            >
                              <td className="px-6 py-4 font-medium flex items-center gap-2 pl-12 text-zinc-600 dark:text-zinc-400">
                                {sub.constituents && sub.constituents.length > 0 && (
                                  expandedCategories[sub.category] ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />
                                )}
                                {sub.category}
                              </td>
                              <td className="px-6 py-4 text-right text-zinc-600 dark:text-zinc-400">₹{sub.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                              <td className="px-6 py-4 text-right text-zinc-600 dark:text-zinc-400">{sub.currentPercentage.toFixed(1)}%</td>
                              <td className="px-6 py-4 text-right text-zinc-600 dark:text-zinc-400">{sub.idealPercentage}%</td>
                              <td className={`px-6 py-4 text-right font-medium ${sub.diffPercentage > 1 ? 'text-red-500' : sub.diffPercentage < -1 ? 'text-blue-500' : 'text-emerald-500'}`}>
                                {sub.diffPercentage > 0 ? '+' : ''}{sub.diffPercentage.toFixed(1)}%
                              </td>
                              <td className="px-6 py-4 text-right">
                                {sub.diffPercentage > 2 ? (
                                  <span className="text-red-500 font-medium">Reduce by ₹{Math.abs(sub.diffValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                ) : sub.diffPercentage < -2 ? (
                                  <span className="text-blue-500 font-medium">Invest ₹{Math.abs(sub.diffValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                ) : (
                                  <span className="text-emerald-500 font-medium">On Track</span>
                                )}
                              </td>
                            </tr>
                            {expandedCategories[sub.category] && sub.constituents && sub.constituents.length > 0 && (
                              <tr className="bg-zinc-50/50 dark:bg-zinc-900/20">
                                <td colSpan={6} className="px-6 py-4">
                                  <div className="pl-16 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-2">
                                    {sub.constituents.map((constituent: any, cIdx: number) => (
                                      <div key={`${constituent.symbol || constituent.name}-${cIdx}`} className="flex justify-between text-sm">
                                        <span className="text-zinc-600 dark:text-zinc-400">{constituent.name} <span className="text-xs opacity-50">({constituent.symbol})</span></span>
                                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                          ₹{constituent.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                          <span className="text-xs text-zinc-500 ml-2 inline-block w-12 text-right">
                                            {((constituent.value / sub.currentValue) * 100).toFixed(1)}%
                                          </span>
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))
                      )}
                      {expandedCategories[item.category] && item.constituents && item.constituents.length > 0 && (
                        <tr className="bg-zinc-50/50 dark:bg-zinc-900/20">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="pl-6 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-2">
                              {item.constituents.map((constituent: any, cIdx: number) => (
                                <div key={`${constituent.symbol || constituent.name}-${cIdx}`} className="flex justify-between text-sm">
                                  <span className="text-zinc-600 dark:text-zinc-400">{constituent.name} <span className="text-xs opacity-50">({constituent.symbol})</span></span>
                                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                    ₹{constituent.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                    <span className="text-xs text-zinc-500 ml-2 inline-block w-12 text-right">
                                      {((constituent.value / item.currentValue) * 100).toFixed(1)}%
                                    </span>
                                  </span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          {/* Asset List */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="text-lg font-semibold">Your Assets</h2>
              <div className="flex items-center gap-3 text-[10px] text-zinc-500 mt-2">
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500"></div> Fetching</div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Fresh</div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-yellow-500"></div> Old</div>
                <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-zinc-300"></div> Unknown</div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-medium cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('name')}>
                      <div className="flex items-center">Asset <SortIndicator column="name" /></div>
                    </th>
                    <th className="px-6 py-4 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('quantity')}>
                      <div className="flex items-center justify-end">Holdings <SortIndicator column="quantity" /></div>
                    </th>
                    <th className="px-6 py-4 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('entryPrice')}>
                      <div className="flex items-center justify-end">Avg. Price <SortIndicator column="entryPrice" /></div>
                    </th>
                    <th className="px-6 py-4 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('currentPrice')}>
                      <div className="flex items-center justify-end">LTP <SortIndicator column="currentPrice" /></div>
                    </th>
                    <th className="px-6 py-4 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('investedValue')}>
                      <div className="flex items-center justify-end">Invested Value <SortIndicator column="investedValue" /></div>
                    </th>
                    <th className="px-6 py-4 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('currentValue')}>
                      <div className="flex items-center justify-end">Current Value <SortIndicator column="currentValue" /></div>
                    </th>
                    <th className="px-6 py-4 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('pnl')}>
                      <div className="flex items-center justify-end">P&L <SortIndicator column="pnl" /></div>
                    </th>
                    <th className="px-6 py-4 font-medium text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {mergedAssets.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-zinc-500">
                        No assets added yet. Click &quot;Add Asset&quot; to get started.
                      </td>
                    </tr>
                  ) : (
                    renderAssets.map((asset, index) => {
                      const currentCategory = normalizeCategory(asset.type);
                      const prevCategory = index > 0 ? normalizeCategory(renderAssets[index - 1].type) : '';
                      const showHeader = index === 0 || currentCategory !== prevCategory;

                      const renderItem = (item: Asset, isSubItem: boolean = false, isGroupHead: boolean = false) => {
                        const priceData = prices[item.symbol];
                        const hasPrice = priceData?.regularMarketPrice != null;
                        const currentPriceRaw = item.manualPrice !== undefined ? item.manualPrice : (hasPrice ? priceData.regularMarketPrice : item.entryPrice);
                        
                        let currentCurrency;
                        if (item.manualPrice !== undefined) {
                          currentCurrency = item.currency || guessCurrency(item.symbol);
                        } else if (hasPrice) {
                          currentCurrency = priceData.currency || guessCurrency(item.symbol);
                          if (typeof item.symbol === 'string' && item.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
                        } else {
                          currentCurrency = item.currency || guessCurrency(item.symbol);
                        }
                        
                        const assetCurrency = item.currency || guessCurrency(item.symbol);
                        const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
                        const entryPrice = isGroupHead ? item.entryPrice : getConvertedPrice(item.entryPrice, assetCurrency, usdToInr);
                        
                        const currentValue = currentPrice * item.quantity;
                        const investedValue = entryPrice * item.quantity;
                        const pnl = currentValue - investedValue;
                        const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
                        
                        let displaySector = item.manualSector;
                        if (!displaySector) {
                          const fundData = fundHoldings[item.symbol];
                          const sectors = fundData?.sectorWeightings || [];
                          if (sectors.length > 0) {
                            const topSector = [...sectors].sort((a, b) => (b.percentage || 0) - (a.percentage || 0))[0];
                            displaySector = topSector ? `Top: ${topSector.sector}` : 'Diversified';
                          } else {
                            displaySector = priceData?.sector || 'Uncategorized';
                          }
                        }
                        
                        const priceSource = priceData?.source;
                        const sectorSource = item.manualSector ? 'Manual' : (fundHoldings[item.symbol]?.source || priceData?.source);

                        return (
                          <tr key={item.id} className={`group/row transition-colors ${isSubItem ? 'bg-zinc-50/50 dark:bg-zinc-900/10 border-l-2 border-blue-500/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'}`}>
                            <td className={`px-6 py-4 ${isSubItem ? 'pl-14' : ''}`}>
                              <div className="flex items-center gap-2">
                                {isGroupHead && (
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedSymbols(prev => ({ ...prev, [item.symbol]: !prev[item.symbol] }));
                                    }}
                                    className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
                                  >
                                    {expandedSymbols[item.symbol] ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-2">
                                    <div className={`font-medium ${isGroupHead ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-zinc-900 dark:text-zinc-100'}`}>
                                      {item.name}
                                      {isGroupHead && <span className="ml-2 text-xs font-normal text-zinc-500"> (Combined)</span>}
                                    </div>
                                    {!isGroupHead && item.exchange && (
                                      <span className="text-[9px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 rounded border border-zinc-200 dark:border-zinc-700 uppercase font-bold tracking-tight">
                                        {item.exchange}
                                      </span>
                                    )}
                                    <PriceStatusIndicator 
                                      lastUpdated={priceData?.lastUpdated} 
                                      isFetching={isLoadingPrices && !priceData} 
                                      symbol={item.symbol} 
                                    />
                                    {(item.symbol === 'GOLD-INR-GRAM' || item.symbol === 'SILVER-INR-GRAM' || item.symbol === 'CASH-INR') && !isGroupHead && (
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          fetchPrices(true, [item.symbol]);
                                        }}
                                        className="ml-1 p-0.5 hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors text-zinc-400 hover:text-blue-500"
                                        title="Refresh Price"
                                      >
                                        <RefreshCw className={`w-3 h-3 ${isLoadingPrices && (!priceData || isLoadingPrices) ? 'animate-spin' : ''}`} />
                                      </button>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-zinc-500 mt-0.5">
                                    {item.symbol} &bull; {displaySector}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right font-medium text-zinc-700 dark:text-zinc-300">
                              {item.quantity.toLocaleString('en-IN', { maximumFractionDigits: 6 })}
                              {item.symbol === 'GOLD-INR-GRAM' ? ' g' : ''}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="text-zinc-900 dark:text-zinc-100 font-mono text-xs">
                                ₹{entryPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right">
                              {priceData || item.manualPrice ? (
                                <div className="flex flex-col items-end">
                                  <div className="text-zinc-900 dark:text-zinc-100 font-mono text-xs font-bold">
                                    ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                  {priceSource && !isGroupHead && <span className="text-[8px] opacity-40 italic">via {priceSource}</span>}
                                </div>
                              ) : <span className="text-zinc-400 text-xs italic">N/A</span>}
                            </td>
                            <td className="px-6 py-4 text-right font-mono text-xs text-zinc-500">
                              ₹{investedValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-zinc-900 dark:text-zinc-100 font-mono text-xs">
                              ₹{currentValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className={`font-bold text-xs ${pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                {pnl >= 0 ? '+' : ''}₹{pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </div>
                              <div className={`text-[10px] ${pnl >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                                {pnl >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                              </div>
                            </td>
                            <td className="px-6 py-4 text-center">
                              {!isGroupHead ? (
                                <div className="flex justify-center gap-1 opacity-100 lg:opacity-40 group-hover/row:opacity-100 transition-opacity">
                                  {!item.id.includes('binance-') && !item.id.includes('coindcx-') ? (
                                    <>
                                      <button onClick={() => handleEditAsset(item)} className="p-1.5 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                                      <button onClick={() => handleDeleteAsset(item.id)} className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </>
                                  ) : (
                                    <div className="text-[10px] text-zinc-400 italic">Exchange Managed</div>
                                  )}
                                </div>
                              ) : (
                                <button 
                                  onClick={() => setExpandedSymbols(prev => ({ ...prev, [item.symbol]: !prev[item.symbol] }))}
                                  className="text-[10px] text-blue-500 hover:underline"
                                >
                                  {expandedSymbols[item.symbol] ? 'Hide Details' : 'Show Exchanges'}
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      };


                      return (
                        <Fragment key={asset.id}>
                          {showHeader && (() => {
                            const isExpanded = expandedTableCategories[currentCategory];
                            if (isExpanded) {
                              return (
                                <tr 
                                  className="bg-zinc-100/50 dark:bg-zinc-800/30 border-t border-zinc-200 dark:border-zinc-800 cursor-pointer"
                                  onClick={() => setExpandedTableCategories(prev => ({ ...prev, [currentCategory]: !prev[currentCategory] }))}
                                >
                                  <td colSpan={8} className="px-6 py-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                                    <ChevronDown className="w-3 h-3" />
                                    {currentCategory}
                                  </td>
                                </tr>
                              );
                            } else {
                              const stats = portfolioStats.byCategory[currentCategory] || { quantity: 0, currentValue: 0, investedValue: 0 };
                              const combinedPnl = stats.currentValue - stats.investedValue;
                              const combinedPnlPercent = stats.investedValue > 0 ? (combinedPnl / stats.investedValue) * 100 : 0;
                              return (
                                <tr 
                                  className="bg-zinc-50/50 dark:bg-zinc-900/50 border-t border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 transition-colors"
                                  onClick={() => setExpandedTableCategories(prev => ({ ...prev, [currentCategory]: true }))}
                                >
                                  <td className="px-6 py-4 font-bold text-zinc-700 dark:text-zinc-300">
                                    <div className="flex items-center gap-2"><ChevronRight className="w-4 h-4 text-zinc-400" />{currentCategory}</div>
                                  </td>
                                  <td className="px-6 py-4 text-right font-medium text-zinc-500">
                                    {stats.quantity.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </td>
                                  <td colSpan={2} className="px-6 py-4"></td>
                                  <td className="px-6 py-4 text-right font-bold text-zinc-900 dark:text-zinc-100">
                                    ₹{stats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-6 py-4 text-right font-bold text-zinc-900 dark:text-zinc-100">
                                    ₹{stats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-6 py-4 text-right font-bold">
                                    <div className={`${combinedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                      {combinedPnl >= 0 ? '+' : ''}₹{combinedPnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                    </div>
                                    <div className={`text-xs ${combinedPnl >= 0 ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-red-600/80 dark:text-red-400/80'}`}>
                                      {combinedPnl >= 0 ? '+' : ''}{combinedPnlPercent.toFixed(2)}%
                                    </div>
                                  </td>
                                  <td className="px-6 py-4"></td>
                                </tr>
                              );
                            }
                          })()}

                          {expandedTableCategories[currentCategory] && (() => {
                            const isSmall = isSmallCrypto(asset);
                            const prevIsSmall = index > 0 && isSmallCrypto(renderAssets[index - 1]);
                            const isSmallCryptoExpanded = expandedTableCategories['SmallCrypto'];
                            const renderRow = !isSmall || isSmallCryptoExpanded;
                            
                            return (
                              <Fragment>
                                {isSmall && !prevIsSmall && (
                                  isSmallCryptoExpanded ? (
                                    <tr 
                                      className="bg-zinc-100/30 dark:bg-zinc-800/10 border-t border-zinc-200/50 dark:border-zinc-800/50 cursor-pointer"
                                      onClick={() => setExpandedTableCategories(prev => ({ ...prev, 'SmallCrypto': !prev['SmallCrypto'] }))}
                                    >
                                      <td colSpan={8} className="px-6 py-2 pl-10 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                                        <ChevronDown className="w-3 h-3" /> Others (Crypto &lt; ₹10)
                                      </td>
                                    </tr>
                                  ) : (
                                    <tr 
                                      className="bg-zinc-50/30 dark:bg-zinc-900/30 border-t border-zinc-200/50 dark:border-zinc-800/50 cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 transition-colors"
                                      onClick={() => setExpandedTableCategories(prev => ({ ...prev, 'SmallCrypto': true }))}
                                    >
                                      <td className="px-6 py-3 pl-10 font-bold text-zinc-600 dark:text-zinc-400">
                                        <div className="flex items-center gap-2 text-xs"><ChevronRight className="w-3 h-3 text-zinc-400" /> Others (Crypto &lt; ₹10)</div>
                                      </td>
                                      <td className="px-6 py-3 text-right font-medium text-zinc-500 text-xs">{portfolioStats.smallCryptoStats.quantity.toLocaleString('en-IN')}</td>
                                      <td colSpan={2} className="px-6 py-3"></td>
                                      <td className="px-6 py-3 text-right font-bold text-zinc-700 dark:text-zinc-300 text-xs">₹{portfolioStats.smallCryptoStats.investedValue.toLocaleString('en-IN')}</td>
                                      <td className="px-6 py-3 text-right font-bold text-zinc-700 dark:text-zinc-300 text-xs">₹{portfolioStats.smallCryptoStats.currentValue.toLocaleString('en-IN')}</td>
                                      <td className="px-6 py-3 text-right font-bold text-xs">
                                        <div className={`${(portfolioStats.smallCryptoStats.currentValue - portfolioStats.smallCryptoStats.investedValue) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                          {(portfolioStats.smallCryptoStats.currentValue - portfolioStats.smallCryptoStats.investedValue) >= 0 ? '+' : ''}₹{(portfolioStats.smallCryptoStats.currentValue - portfolioStats.smallCryptoStats.investedValue).toLocaleString('en-IN')}
                                        </div>
                                      </td>
                                      <td className="px-6 py-3"></td>
                                    </tr>
                                  )
                                )}
                                {renderRow && (
                                  <Fragment>
                                    {renderItem(asset, false, asset.isGroup)}
                                    {asset.isGroup && expandedSymbols[asset.symbol] && (asset.subItems || []).map(sub => (
                                      <Fragment key={sub.id}>
                                        {renderItem(sub, true, false)}
                                      </Fragment>
                                    ))}
                                  </Fragment>
                                )}
                              </Fragment>
                            );
                          })()}
                        </Fragment>
                      );
                    })
                  )}
                  {mergedAssets.length > 0 && (
                    <Fragment>
                      <tr 
                        className="bg-zinc-100 dark:bg-zinc-900 font-bold border-t-2 border-zinc-200 dark:border-zinc-800 cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
                        onClick={() => setExpandedTableCategories(prev => ({ ...prev, 'Total Portfolio': !prev['Total Portfolio'] }))}
                      >
                        <td className="px-6 py-4 text-zinc-900 dark:text-zinc-100 uppercase tracking-wider text-xs flex items-center gap-2">
                          {expandedTableCategories['Total Portfolio'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          Total Portfolio
                        </td>
                        <td className="px-6 py-4 text-right">
                          {mergedAssets.reduce((sum, a) => sum + a.quantity, 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-6 py-4 text-right"></td>
                        <td className="px-6 py-4 text-right"></td>
                        <td className="px-6 py-4 text-right">
                          ₹{portfolioStats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4 text-right">
                          ₹{portfolioStats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className={`flex flex-col items-end ${totalProfitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            <span>{totalProfitLoss >= 0 ? '+' : ''}₹{totalProfitLoss.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                            <span className="text-[10px]">({totalProfitLossPercent.toFixed(2)}%)</span>
                          </div>
                        </td>
                        <td className="px-6 py-4"></td>
                      </tr>
                      {expandedTableCategories['Total Portfolio'] && (
                        <tr className="bg-zinc-50 dark:bg-zinc-950/50">
                          <td colSpan={8} className="px-6 py-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                              {/* Summary Stats */}
                              <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Total Invested</div>
                                <div className="text-lg font-bold">₹{portfolioStats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                              </div>
                              <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Current Value</div>
                                <div className="text-lg font-bold">₹{portfolioStats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                              </div>
                              <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Total P&L</div>
                                <div className={`text-lg font-bold ${totalProfitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  ₹{totalProfitLoss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                </div>
                              </div>
                              <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                                <div className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1">Total Returns</div>
                                <div className={`text-lg font-bold ${totalProfitLossPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {totalProfitLossPercent >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%
                                </div>
                              </div>
                            </div>

                            <div className="mt-6">
                              <h4 className="text-xs font-bold uppercase tracking-widest text-zinc-500 mb-4 px-1">Category Breakdown</h4>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                {Object.entries(
                                  mergedAssets.reduce((acc, asset) => {
                                    const cat = normalizeCategory(asset.type);
                                    if (!acc[cat]) acc[cat] = { currentValue: 0, investedValue: 0 };
                                    
                                    const priceData = prices[asset.symbol];
                                    const hasPrice = priceData?.regularMarketPrice != null;
                                    const currentPriceRaw = asset.manualPrice !== undefined ? asset.manualPrice : (hasPrice ? priceData.regularMarketPrice : asset.entryPrice);
                                    
                                    let currentCurrency;
                                    if (asset.manualPrice !== undefined) {
                                      currentCurrency = asset.currency || guessCurrency(asset.symbol);
                                    } else if (hasPrice) {
                                      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
                                      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
                                    } else {
                                      currentCurrency = asset.currency || guessCurrency(asset.symbol);
                                    }
                                    
                                    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency, usdToInr);
                                    const assetCurrency = asset.currency || guessCurrency(asset.symbol);
                                    const entryPriceConverted = getConvertedPrice(asset.entryPrice, assetCurrency, usdToInr);
                                    
                                    acc[cat].currentValue += currentPrice * asset.quantity;
                                    acc[cat].investedValue += entryPriceConverted * asset.quantity;
                                    return acc;
                                  }, {} as Record<string, { currentValue: number, investedValue: number }>)
                                ).map(([category, stats]) => {
                                  const pnl = stats.currentValue - stats.investedValue;
                                  const pnlPercent = stats.investedValue > 0 ? (pnl / stats.investedValue) * 100 : 0;
                                  return (
                                    <div key={category} className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm">
                                      <div className="flex justify-between items-start mb-2">
                                        <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{category}</div>
                                        <div className={`text-[10px] font-bold ${pnlPercent >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                                          {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(1)}%
                                        </div>
                                      </div>
                                      <div className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                                        ₹{stats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                      </div>
                                      <div className="text-[10px] text-zinc-500 mt-1">
                                        Invested: ₹{stats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Underlying Holdings */}
          <div className="lg:col-span-1 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-2">
              <List className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-semibold">Top Underlying Exposure</h2>
            </div>
            <div className="overflow-y-auto max-h-[400px]">
              {topUnderlying.length === 0 ? (
                <div className="p-6 text-center text-zinc-500 text-sm">
                  {Object.keys(holdingsErrors).length > 0 ? (
                    <div className="text-red-500">
                      Error loading holdings: {Object.values(holdingsErrors)[0]}
                    </div>
                  ) : (
                    "No exposure data available"
                  )}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {topUnderlying.map((item, idx) => (
                    <li key={`${item.symbol || item.name}-${idx}`} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex justify-between items-center">
                      <div className="overflow-hidden pr-3">
                        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">{item.name}</div>
                        <div className="text-xs text-zinc-500 mt-0.5">{item.symbol}</div>
                      </div>
                      <div className="text-right whitespace-nowrap">
                        <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                          ₹{item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5">
                          {((item.value / portfolioStats.currentValue) * 100).toFixed(1)}%
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </>
    ) : (
      <Screener onAdd={handleScreenerAdd} />
    )}
      </div>


      {/* Add Asset Modal */}
      <AddAssetModal
        isAddModalOpen={isAddModalOpen}
        setIsAddModalOpen={setIsAddModalOpen}
        editingAssetId={editingAssetId}
        resetForm={resetForm}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        setSearchResults={setSearchResults}
        selectedResult={selectedResult}
        setSelectedResult={setSelectedResult}
        isSearching={isSearching}
        findExistingAssetToMerge={findExistingAssetToMerge}
        quantity={quantity}
        setQuantity={setQuantity}
        entryPrice={entryPrice}
        setEntryPrice={setEntryPrice}
        entryCurrency={entryCurrency}
        setEntryCurrency={setEntryCurrency}
        investedValueInput={investedValueInput}
        setInvestedValueInput={setInvestedValueInput}
        usdToInr={usdToInr}
        purchaseDate={purchaseDate}
        setPurchaseDate={setPurchaseDate}
        handleAddAsset={handleAddAsset}
        manualPrice={manualPrice}
        setManualPrice={setManualPrice}
        manualSector={manualSector}
        setManualSector={setManualSector}
        handleMergeAsset={() => {}}
      />

      {/* Settings Modal */}
      <SettingsModal
        isSettingsOpen={isSettingsOpen}
        setIsSettingsOpen={setIsSettingsOpen}
        searchSource={searchSource}
        setSearchSource={setSearchSource}
        aiProvider={aiProvider}
        setAiProvider={setAiProvider}
        openRouterKey={openRouterKey}
        saveOpenRouterKey={saveOpenRouterKey}
        availableModels={availableModels}
        selectedModel={selectedModel}
        setSelectedModel={setSelectedModel}
        googleModel={googleModel}
        setGoogleModel={setGoogleModel}
        handleExportData={handleExportData}
        handleImportData={handleImportData}
        handleRestoreFromMongo={handleRestoreFromMongo}
        restoreStatus={restoreStatus}
        syncToDb={syncToDb}
        fetchPrices={fetchPrices}
        isLoadingPrices={isLoadingPrices}
        assets={assets}
      />

      {/* Allocation Settings Modal */}
      <AllocationSettingsModal
        isAllocationSettingsOpen={isAllocationSettingsOpen}
        setIsAllocationSettingsOpen={setIsAllocationSettingsOpen}
        idealAllocation={idealAllocation}
        setIdealAllocation={setIdealAllocation}
        syncToDb={syncToDb}
        allCategories={allCategories}
        consolidatedAllocation={consolidatedAllocation}
      />

      {/* Manual Sector Allocation Modal */}
      <ManualSectorModal
        manualSectorModal={manualSectorModal}
        setManualSectorModal={setManualSectorModal}
        fundHoldings={fundHoldings}
        syncToDb={syncToDb}
      />

      {/* Manual Fund Holding Entry Modal */}
      <ManualFundModal
        manualFundModal={manualFundModal}
        setManualFundModal={setManualFundModal}
        fundHoldings={fundHoldings}
        syncToDb={syncToDb}
      />

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        assetToDelete={assetToDelete}
        setAssetToDelete={setAssetToDelete}
        assets={assets}
        confirmDelete={confirmDelete}
      />
    </div>
  );
}
