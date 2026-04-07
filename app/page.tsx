'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Plus, Search, Trash2, RefreshCw, TrendingUp, TrendingDown, DollarSign, PieChart as PieChartIcon, BarChart3, List, MessageCircle, Settings, Target, X, Send, Bot, ArrowUp, ArrowDown, ArrowUpDown, MessageSquarePlus, ChevronUp, ChevronDown, ChevronRight, Pencil, Info, LogOut } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { auth, db, signInWithGoogle, logOut, handleFirestoreError, OperationType } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, updateDoc, onSnapshot, getDoc } from 'firebase/firestore';

type Asset = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  entryPrice: number;
  currency: string;
  type: string;
  categoryPath?: string[];
};

type PriceData = {
  symbol: string;
  regularMarketPrice: number;
  currency: string;
  shortName: string;
  marketCap?: number;
  quoteType?: string;
};

type ChatMessage = {
  role: string;
  content: string | null;
  thought?: string;
  thoughtSignature?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  model?: string;
};

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

export default function Dashboard() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({ key: 'currentValue', direction: 'desc' });
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [entryCurrency, setEntryCurrency] = useState('INR');
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [assetToDelete, setAssetToDelete] = useState<string | null>(null);
  const [fundHoldings, setFundHoldings] = useState<Record<string, any>>({});
  const [holdingsErrors, setHoldingsErrors] = useState<Record<string, string>>({});
  const loadingHoldings = useRef<Record<string, boolean>>({});

  const [idealAllocation, setIdealAllocation] = useState<Record<string, number>>({
    'Equities': 60,
    'Fixed Income': 20,
    'Crypto': 10,
    'Cash': 10,
  });

  // AI State
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAllocationSettingsOpen, setIsAllocationSettingsOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: 'Hi! I can help you manage your portfolio. Try saying "Add 10 shares of Apple at $150" or "Remove Reliance".' }]);
  const [aiInput, setAiInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [aiProvider, setAiProvider] = useState<'openrouter' | 'google'>('google');
  const [searchSource, setSearchSource] = useState<'indianapi' | 'yahoo' | 'newapi'>('yahoo');
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState('meta-llama/llama-3.3-70b-instruct:free');
  const [googleModel, setGoogleModel] = useState('gemini-3.1-flash-lite-preview');

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const usdToInr = prices['INR=X']?.regularMarketPrice || 83;

  const guessCurrency = (symbol: string) => {
    if (!symbol || typeof symbol !== 'string') return 'INR';
    const upper = symbol.toUpperCase();
    if (upper.endsWith('.NS') || upper.endsWith('.BO')) return 'INR';
    if (upper.endsWith('.L')) return 'GBp';
    if (upper.includes('-USD')) return 'USD'; // Explicit crypto USD
    if (upper.includes('-')) return 'USD'; // Other crypto usually USD
    // Default to USD for typical US tickers (AAPL, MSFT, etc) if no suffix and not an Indian exchange
    if (!upper.includes('.') && !upper.endsWith('.NS') && !upper.endsWith('.BO')) return 'USD';
    return 'INR';
  };

  const getConvertedPrice = (price: number, currency: string) => {
    if (currency === 'USD') return price * usdToInr;
    if (currency === 'GBp') return (price / 100) * 105; // Approx GBP to INR
    return price;
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isChatOpen) {
      scrollToBottom();
    }
  }, [chatMessages, isAiTyping, isChatOpen]);

  const scrollToTop = () => {
    chatContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const startNewChat = () => {
    setChatMessages([{ role: 'assistant', content: 'Hi! I can help you manage your portfolio. Try saying "Add 10 shares of Apple at $150" or "Remove Reliance".' }]);
  };

  const syncToDb = async (updates: any) => {
    if (!user) return;
    try {
      const userRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(userRef);
      
      const firestoreUpdates: any = {};
      if (updates.assets !== undefined) firestoreUpdates.assets = updates.assets;
      if (updates.fundHoldings !== undefined) firestoreUpdates.fundHoldings = updates.fundHoldings;
      if (updates.settings) {
        for (const [key, value] of Object.entries(updates.settings)) {
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
            assets: updates.assets || assets,
            fundHoldings: updates.fundHoldings || fundHoldings,
            settings: {
              idealAllocation,
              searchSource,
              openRouterKey,
              aiProvider,
              googleModel,
              openrouterModel: selectedModel,
              ...(updates.settings || {})
            }
          };
          await setDoc(userRef, initialData);
        }
      }

      // Sync to MongoDB backup
      try {
        await fetch('/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            data: updates
          })
        });
      } catch (e) {
        console.error('Failed to sync to MongoDB backup', e);
      }
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, `users/${user?.uid}`);
    }
  };

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
    assets.forEach(asset => {
      const needsFetch = (asset.type === 'MUTUALFUND' || asset.type === 'ETF') && 
        (!fundHoldings[asset.symbol] || fundHoldings[asset.symbol].assetAllocation === undefined || fundHoldings[asset.symbol].assetAllocation === null) && 
        !loadingHoldings.current[asset.symbol];
        
      if (needsFetch) {
        loadingHoldings.current[asset.symbol] = true;
        fetch(`/api/holdings?symbol=${encodeURIComponent(asset.symbol)}`)
          .then(async res => {
            const text = await res.text();
            try {
              return JSON.parse(text);
            } catch (e) {
              console.error('Failed to parse holdings data:', text.substring(0, 100));
              return { holdings: [] };
            }
          })
          .then(data => {
            if (data.debug) {
              console.log(`Holdings debug for ${asset.symbol}: ${data.debug}`);
            }
            if (data.error) {
              setHoldingsErrors(prev => ({ ...prev, [asset.symbol]: data.error }));
            }
            const hasHoldings = data.holdings && data.holdings.length > 0;
            const hasSectors = data.sectorWeightings && data.sectorWeightings.length > 0;
            
            if (hasHoldings || hasSectors || data.categoryName || data.assetAllocation) {
              setFundHoldings(prev => {
                const updated = { 
                  ...prev, 
                  [asset.symbol]: {
                    holdings: data.holdings || [],
                    sectorWeightings: data.sectorWeightings || [],
                    categoryName: data.categoryName || null,
                    assetAllocation: data.assetAllocation || null
                  }
                };
                syncToDb({ fundHoldings: updated });
                return updated;
              });
            } else if (!data.error) {
              // No holdings found but no error, mark as empty to stop retrying
              setFundHoldings(prev => ({ ...prev, [asset.symbol]: { holdings: [], sectorWeightings: [], categoryName: null, assetAllocation: null } }));
            }
          })
          .catch(err => {
            console.error(`Holdings fetch failed for ${asset.symbol}`, err);
            setHoldingsErrors(prev => ({ ...prev, [asset.symbol]: err.message }));
          });
      }
    });
  }, [assets, fundHoldings]);

  const fetchPrices = useCallback(async () => {
    if (assets.length === 0) return;
    
    setIsLoadingPrices(true);
    try {
      const symbolsSet = new Set<string>();
      assets.forEach(a => symbolsSet.add(a.symbol));
      symbolsSet.add('INR=X');

      Object.values(fundHoldings).forEach(fundData => {
        const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
        holdings.forEach((h: any) => {
          if (h.symbol) symbolsSet.add(h.symbol);
        });
      });

      const symbols = Array.from(symbolsSet);
      const newPrices: Record<string, PriceData> = {};
      
      const chunkSize = 20;
      for (let i = 0; i < symbols.length; i += chunkSize) {
        const chunk = symbols.slice(i, i + chunkSize);
        const res = await fetch(`/api/price?symbols=${chunk.join(',')}`);
        
        if (!res.ok) {
          console.error(`Price API returned status ${res.status} for chunk ${i}`);
          continue;
        }

        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          console.error(`Price API returned non-JSON content-type: ${contentType}`);
          continue;
        }

        let data;
        const text = await res.text();
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error('Failed to parse price data:', text.substring(0, 100));
          continue;
        }
        
        if (Array.isArray(data)) {
          data.forEach((item: any) => {
            newPrices[item.symbol] = {
              symbol: item.symbol,
              regularMarketPrice: item.regularMarketPrice,
              currency: item.currency,
              shortName: item.shortName || item.longName || item.symbol,
              marketCap: item.marketCap,
              quoteType: item.quoteType
            };
          });
        }
      }
      
      setPrices(prev => ({ ...prev, ...newPrices }));
    } catch (error) {
      console.error("Failed to fetch prices", error);
    } finally {
      setIsLoadingPrices(false);
    }
  }, [assets, fundHoldings]);

  useEffect(() => {
    if (assets.length > 0) {
      fetchPrices();
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
        currency: entryCurrency,
      } : a);
    } else {
      const newAsset: Asset = {
        id: uuidv4(),
        symbol: selectedResult.symbol,
        name: selectedResult.shortname || selectedResult.longname || selectedResult.symbol,
        quantity: parseFloat(quantity),
        entryPrice: parseFloat(entryPrice),
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

  const handleMergeAsset = () => {
    if (!selectedResult || !quantity || !entryPrice) return;
    
    const existing = assets.find(a => a.symbol === selectedResult.symbol);
    if (!existing) return;

    const newQty = parseFloat(quantity);
    const newPrice = parseFloat(entryPrice);
    
    // Convert both to INR for averaging
    const existingEntryPriceInInr = getConvertedPrice(existing.entryPrice, existing.currency || guessCurrency(existing.symbol));
    const newEntryPriceInInr = getConvertedPrice(newPrice, entryCurrency);
    
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

  const sortedAssets = [...assets].sort((a, b) => {
    if (!sortConfig.key || !sortConfig.direction) return 0;

    const getVal = (asset: Asset) => {
      const priceData = prices[asset.symbol];
      const hasPrice = priceData?.regularMarketPrice != null;
      const currentPriceRaw = hasPrice ? priceData.regularMarketPrice : asset.entryPrice;
      
      let currentCurrency;
      if (hasPrice) {
        currentCurrency = priceData.currency || guessCurrency(asset.symbol);
        if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
      } else {
        currentCurrency = asset.currency || guessCurrency(asset.symbol);
      }
      
      const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
      
      let assetCurrency = asset.currency || guessCurrency(asset.symbol);
      const entryPrice = getConvertedPrice(asset.entryPrice, assetCurrency);

      switch (sortConfig.key) {
        case 'name': return asset.name || '';
        case 'symbol': return asset.symbol || '';
        case 'quantity': return asset.quantity;
        case 'entryPrice': return entryPrice;
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
      return sortConfig.direction === 'asc' 
        ? valA.localeCompare(valB) 
        : valB.localeCompare(valA);
    }

    if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

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
    setEntryCurrency(asset.currency || guessCurrency(asset.symbol));
    setIsAddModalOpen(true);
  };

  const resetForm = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResult(null);
    setQuantity('');
    setEntryPrice('');
    setEntryCurrency('INR');
    setEditingAssetId(null);
  };

  const saveOpenRouterKey = (key: string) => {
    setOpenRouterKey(key);
    syncToDb({ settings: { openRouterKey: key } });
    setIsSettingsOpen(false);
  };

  const callOpenRouter = async (messages: any[], tools: any[]) => {
    if (aiProvider === 'google') {
      const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Gemini API key is not available in this environment. Please try using OpenRouter instead.');
      }
      const ai = new GoogleGenAI({ apiKey });
      
      const systemPrompt = messages.find(m => m.role === 'system')?.content;
      
      const geminiMessages: any[] = [];
      let lastGeminiMessage: any = null;

      for (const m of messages.filter(m => m.role !== 'system')) {
        if (m.role === 'tool') {
          const functionResponse = {
            functionResponse: {
              name: m.name,
              response: { result: m.content }
            }
          };

          if (lastGeminiMessage && lastGeminiMessage.role === 'user' && lastGeminiMessage.parts.some((p: any) => p.functionResponse)) {
            lastGeminiMessage.parts.push(functionResponse);
            continue;
          } else {
            const newMessage = {
              role: 'user',
              parts: [functionResponse]
            };
            geminiMessages.push(newMessage);
            lastGeminiMessage = newMessage;
            continue;
          }
        }

        const parts: any[] = [];
        
        // Only include thought part if we have a signature, otherwise it causes 'missing thought signature' errors
        if (m.thoughtSignature !== undefined && !m.tool_calls) {
          parts.push({ text: m.thought || '', thought: true, thoughtSignature: m.thoughtSignature });
        }

        if (m.content && m.content.trim()) {
          parts.push({ text: m.content });
        }

        if (m.tool_calls) {
          parts.push(...m.tool_calls.map((tc: any) => ({
            functionCall: {
              name: tc.function.name,
              args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
              ...(m.thoughtSignature && { thoughtSignature: m.thoughtSignature })
            }
          })));
        }

        // Ensure at least one part is present for user/model turns
        if (parts.length === 0) {
          parts.push({ text: m.content || '' });
        }

        const newMessage = {
          role: m.role === 'user' ? 'user' : 'model',
          parts
        };
        geminiMessages.push(newMessage);
        lastGeminiMessage = newMessage;
      }

      const mapSchema = (schema: any): any => {
        if (schema.type === 'object') {
          return {
            type: Type.OBJECT,
            description: schema.description,
            properties: schema.properties ? Object.fromEntries(
              Object.entries(schema.properties).map(([k, v]) => [k, mapSchema(v)])
            ) : undefined,
            required: schema.required
          };
        } else if (schema.type === 'array') {
          return {
            type: Type.ARRAY,
            description: schema.description,
            items: schema.items ? mapSchema(schema.items) : undefined
          };
        } else if (schema.type === 'number') {
          return { type: Type.NUMBER, description: schema.description };
        } else if (schema.type === 'boolean') {
          return { type: Type.BOOLEAN, description: schema.description };
        } else {
          return { type: Type.STRING, description: schema.description };
        }
      };

      const geminiTools: any[] = tools ? [{
        functionDeclarations: tools.map((t: any) => {
          const hasProperties = Object.keys(t.function.parameters?.properties || {}).length > 0;
          const declaration: any = {
            name: t.function.name,
            description: t.function.description,
          };
          if (hasProperties) {
            declaration.parameters = mapSchema(t.function.parameters);
          }
          return declaration;
        })
      }] : [];
      
      geminiTools.push({ googleSearch: {} });

      const isPro = googleModel.includes('pro');
      const isGemini3 = googleModel.includes('gemini-3');
      // For Gemini 3 models, use LOW for Pro to ensure reasoning while keeping latency down,
      // and MINIMAL for Flash Lite to minimize latency (it's the default anyway).
      const thinkingLevel = isGemini3 ? (isPro ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL) : undefined;

      console.log('Gemini Messages being sent:', JSON.stringify(geminiMessages, null, 2));

      const response = await ai.models.generateContent({
        model: googleModel,
        contents: geminiMessages,
        config: {
          systemInstruction: systemPrompt,
          tools: geminiTools.length > 0 ? geminiTools : undefined,
          toolConfig: { includeServerSideToolInvocations: true },
          thinkingConfig: thinkingLevel ? { thinkingLevel } : undefined
        }
      });

      const thoughtPart = response.candidates?.[0]?.content?.parts?.find((p: any) => p.thought === true);
      const thoughtText = thoughtPart?.text;
      const thoughtSignature = thoughtPart?.thoughtSignature;
      const text = response.candidates?.[0]?.content?.parts?.find((p: any) => p.text && p.thought !== true)?.text || '';
      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        return {
          model: googleModel,
          choices: [{
            message: {
              role: 'assistant',
              content: text || null,
              thought: thoughtText,
              thoughtSignature: thoughtSignature,
              tool_calls: functionCalls.map((fc: any) => ({
                id: uuidv4(),
                type: 'function',
                function: {
                  name: fc.name,
                  arguments: JSON.stringify(fc.args)
                }
              }))
            }
          }]
        };
      }

      return {
        model: googleModel,
        choices: [{
          message: {
            role: 'assistant',
            content: text,
            thought: thoughtText,
            thoughtSignature: thoughtSignature
          }
        }]
      };
    }

    let currentModel = selectedModel;
    let originalModel = selectedModel;
    let res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: currentModel,
        messages: messages,
        tools: tools,
        key: openRouterKey
      })
    });

    // Automatic fallback for free models if rate limited
    if (!res.ok && availableModels.length > 0 && (currentModel.includes(':free') || currentModel === 'meta-llama/llama-3.3-70b-instruct:free')) {
      let err;
      try {
        err = JSON.parse(await res.clone().text());
      } catch (e) {}
      
      const isRateLimited = err?.error?.code === 429 || 
                            err?.error?.message?.includes('429') || 
                            err?.error?.message?.includes('rate limit') || 
                            err?.error?.metadata?.raw?.includes('rate-limited');
                            
      if (isRateLimited) {
        console.log(`Model ${currentModel} is rate limited. Trying fallbacks...`);
        // Try up to 3 other free models
        const fallbackModels = availableModels.filter(m => m.id !== currentModel).slice(0, 3);
        let fallbackSuccess = false;
        for (const fallback of fallbackModels) {
          console.log(`Trying fallback model: ${fallback.id}`);
          const fallbackRes = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: fallback.id,
              messages: messages,
              tools: tools,
              key: openRouterKey
            })
          });
          if (fallbackRes.ok) {
            res = fallbackRes;
            currentModel = fallback.id;
            fallbackSuccess = true;
            break;
          }
        }
        if (!fallbackSuccess) {
          currentModel = originalModel; // Revert to original model name for the error message
        }
      }
    }

    if (!res.ok) {
      let err;
      const text = await res.text();
      try {
        err = JSON.parse(text);
      } catch (e) {
        err = { error: { message: `Server error (${res.status}): ${text.substring(0, 100)}` } };
      }
      let errorMessage = err.error?.message || 'Failed to call OpenRouter';
      const rawMetadata = err.error?.metadata?.raw || '';
      
      if (errorMessage.includes('guardrail restrictions and data policy')) {
        errorMessage = 'The selected free model requires data logging. Please either enable data collection at https://openrouter.ai/settings/privacy or select a different model.';
      } else if (err.error?.code === 429 || errorMessage.includes('requires more credits') || errorMessage.includes('429') || errorMessage.includes('rate limit') || rawMetadata.includes('rate-limited')) {
        errorMessage = `The selected model (${originalModel}) and all available free fallback models are currently rate-limited by their providers. Please try again in a few minutes, or switch to Google Gemini in the settings.`;
      } else if (errorMessage.includes('Provider returned error') || errorMessage.includes('upstream error')) {
        errorMessage = `The selected AI model (${currentModel}) is currently experiencing issues or is unavailable. Please select a different model in the settings.`;
      }
      throw new Error(errorMessage);
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      if (text.trim().startsWith('<')) {
        throw new Error(`Server returned HTML error: ${text.substring(0, 100)}`);
      }
      throw new Error(`Invalid JSON from server: ${text.substring(0, 100)}`);
    }
  };

  const handleAiCommand = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!aiInput.trim()) return;
    if (aiProvider === 'openrouter' && !openRouterKey) {
      setIsSettingsOpen(true);
      return;
    }

    const userText = aiInput.trim();
    const newMessages = [...chatMessages, { role: 'user', content: userText }];
    setChatMessages(newMessages);
    setAiInput('');
    setIsAiTyping(true);

    const tools = [
      {
        type: 'function',
        function: {
          name: 'add_asset',
          description: 'Add a new asset (stock, crypto, mutual fund, ETF) to the portfolio.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The name or symbol of the asset to search for (e.g. "Apple", "BTC-USD", "Reliance")' },
              quantity: { type: 'number', description: 'The number of units/shares' },
              entryPrice: { type: 'number', description: 'The average purchase price per unit' },
              currency: { type: 'string', enum: ['INR', 'USD'], description: 'The currency of the entry price (default is INR)' }
            },
            required: ['query', 'quantity', 'entryPrice']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'remove_asset',
          description: 'Remove an asset from the portfolio by its symbol.',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'The exact symbol of the asset to remove (e.g. "AAPL")' }
            },
            required: ['symbol']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'update_asset',
          description: 'Update the quantity or entry price of an existing asset in the portfolio.',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'The exact symbol of the asset to update (e.g. "AAPL")' },
              quantity: { type: 'number', description: 'The new total quantity of units/shares' },
              entryPrice: { type: 'number', description: 'The new average purchase price per unit' }
            },
            required: ['symbol']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'clear_portfolio',
          description: 'Remove all assets from the portfolio.',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'refresh_prices',
          description: 'Refresh the current market prices for all assets in the portfolio.',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'search_asset',
          description: 'Search for an asset to get its symbol and current price information.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'The name or symbol to search for' }
            },
            required: ['query']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'open_add_modal',
          description: 'Open the manual add asset dialog/modal for the user.',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'close_add_modal',
          description: 'Close the manual add asset dialog/modal.',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'update_asset_category',
          description: 'Update the hierarchical category path of an asset. You can use the standard taxonomy or create new subcategories as needed.',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'The exact symbol of the asset to update' },
              categoryPath: {
                type: 'array',
                description: 'The hierarchical path of categories, e.g., ["Equities", "Domestic", "Large-Cap"] or ["Alternatives", "Cryptocurrency"]',
                items: { type: 'string' }
              }
            },
            required: ['symbol', 'categoryPath']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'update_fund_holdings',
          description: 'Update the underlying stock exposure/holdings for a specific mutual fund or ETF. Use this to manually set the holdings after analyzing a fund from the web.',
          parameters: {
            type: 'object',
            properties: {
              symbol: { type: 'string', description: 'The exact symbol of the mutual fund or ETF in the portfolio' },
              holdings: {
                type: 'array',
                description: 'List of underlying holdings',
                items: {
                  type: 'object',
                  properties: {
                    symbol: { type: 'string', description: 'The underlying stock symbol (e.g. "RELIANCE.NS")' },
                    holdingName: { type: 'string', description: 'The name of the company' },
                    holdingPercent: { type: 'number', description: 'Percentage weight in the fund (0.0 to 1.0, e.g. 0.075 for 7.5%)' }
                  },
                  required: ['symbol', 'holdingName', 'holdingPercent']
                }
              }
            },
            required: ['symbol', 'holdings']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'close_chat',
          description: 'Close the AI chat window.',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      }
    ];

    try {
      let currentMessages = [...newMessages];
      const systemPrompt = { 
        role: 'system', 
        content: `You are a helpful portfolio management assistant. You MUST use the provided tools to control the add, delete, and edit functions of the web app.
        
        CRITICAL RULES:
        1. DO NOT perform any math, P&L calculations, or portfolio value calculations yourself. The web app automatically handles all calculations in the backend. Just use the tools to update the portfolio state.
        2. When the user asks about a stock or wants to add one, use the \`search_asset\` tool. This tool sends an API request to indianapi.in to fetch the latest stock data.
        3. If the user does not provide a price or quantity when adding, ask them for it before calling the \`add_asset\` tool.
        
        You can search the web to analyze mutual funds and update their underlying stock exposure using the update_fund_holdings tool.
        When updating a mutual fund's holdings, match its holdings with the user's current direct assets. List the specific stocks that the user already owns directly. For all other stocks in the fund, group their exposure percentages into 'Large Cap', 'Mid Cap', or 'Small Cap' buckets (use symbol 'LARGE_CAP', 'MID_CAP', or 'SMALL_CAP' and holdingName 'Other Large Cap', 'Other Mid Cap', or 'Other Small Cap').
        CRITICAL: DO NOT ask the user for the percentage weights of ETF or mutual fund holdings. If you cannot find the exact percentages on the web, make your best educated estimate based on the fund's category, benchmark, top holdings, or investment objective. For example, if it's a Large Cap fund, allocate the majority to 'Large Cap'.
        
        TAXONOMY & CATEGORIZATION:
        We use a hierarchical taxonomy for assets (e.g., ["Equities", "Domestic", "Large-Cap"]). 
        Standard top-level categories include: Equities, Fixed Income, Commodities, Real Estate, Cash & Equivalents, Alternatives.
        You can use the update_asset_category tool to classify assets. You are free to invent new subcategories or sub-subcategories if the asset requires it (e.g., ["Alternatives", "Cryptocurrency", "DeFi Tokens"]).
        
        Current portfolio symbols: ${assets.map(a => a.symbol).join(', ')}` 
      };
      
      let response = await callOpenRouter([systemPrompt, ...currentMessages], tools);
      if (!response.choices || response.choices.length === 0) {
        throw new Error(response.error?.message || 'The AI model returned an empty response. It might be overloaded or unavailable.');
      }
      let message = response.choices[0].message;

      if (message.tool_calls) {
        const toolCallMessage = { ...message, role: 'assistant', model: response.model };
        currentMessages.push(toolCallMessage);
        
        const toolResponses: ChatMessage[] = [];
        for (const toolCall of message.tool_calls) {
          let args;
          try {
            args = typeof toolCall.function.arguments === 'string' 
              ? JSON.parse(toolCall.function.arguments) 
              : toolCall.function.arguments;
          } catch (e: any) {
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Error parsing arguments: ${e.message}. Please ensure you provide valid JSON.`
            });
            continue;
          }

          if (toolCall.function.name === 'add_asset') {
            const searchRes = await fetch(`/api/search?q=${encodeURIComponent(args.query || '')}&source=${searchSource}`);
            let searchData;
            const text = await searchRes.text();
            try {
              searchData = JSON.parse(text);
            } catch (e) {
              console.error('Failed to parse search data:', text.substring(0, 100));
            }
            
            if (searchData && Array.isArray(searchData) && searchData.length > 0) {
              const selected = searchData[0];
              const newAsset: Asset = {
                id: uuidv4(),
                symbol: selected.symbol,
                name: selected.shortname || selected.longname || selected.symbol,
                quantity: args.quantity,
                entryPrice: args.entryPrice,
                currency: args.currency || guessCurrency(selected.symbol),
                type: selected.quoteType || 'UNKNOWN',
              };
              
              setAssets(prev => {
                const updated = [...prev, newAsset];
                syncToDb({ assets: updated });
                return updated;
              });
              
              toolResponses.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: `Successfully added ${newAsset.name} (${newAsset.symbol}) to the portfolio.`,
                thoughtSignature: toolCallMessage.thoughtSignature
              });
            } else {
              toolResponses.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: `Could not find any asset matching "${args.query}".`,
                thoughtSignature: toolCallMessage.thoughtSignature
              });
            }
          } else if (toolCall.function.name === 'remove_asset') {
            setAssets(prev => {
              const updated = prev.filter(a => a.symbol.toLowerCase() !== (args.symbol || '').toLowerCase());
              syncToDb({ assets: updated });
              return updated;
            });
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Successfully removed ${args.symbol} from the portfolio.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'update_asset') {
            let updatedAsset = false;
            setAssets(prev => {
              const updated = prev.map(a => {
                if (a.symbol.toLowerCase() === (args.symbol || '').toLowerCase()) {
                  updatedAsset = true;
                  return {
                    ...a,
                    quantity: args.quantity !== undefined ? args.quantity : a.quantity,
                    entryPrice: args.entryPrice !== undefined ? args.entryPrice : a.entryPrice
                  };
                }
                return a;
              });
              syncToDb({ assets: updated });
              return updated;
            });
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: updatedAsset ? `Successfully updated ${args.symbol}.` : `Asset ${args.symbol} not found in portfolio.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'update_asset_category') {
            let updatedAsset = false;
            setAssets(prev => {
              const updated = prev.map(a => {
                if (a.symbol.toLowerCase() === (args.symbol || '').toLowerCase()) {
                  updatedAsset = true;
                  return { ...a, categoryPath: args.categoryPath };
                }
                return a;
              });
              syncToDb({ assets: updated });
              return updated;
            });
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: updatedAsset ? `Successfully updated category for ${args.symbol}.` : `Asset ${args.symbol} not found in portfolio.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'update_fund_holdings') {
            setFundHoldings(prev => {
              const updated = { ...prev, [args.symbol]: args.holdings };
              syncToDb({ fundHoldings: updated });
              return updated;
            });
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Successfully updated holdings for ${args.symbol}.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'clear_portfolio') {
            setAssets([]);
            syncToDb({ assets: [] });
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Successfully cleared the portfolio.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'refresh_prices') {
            await fetchPrices();
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Successfully triggered a price refresh.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'search_asset') {
            const searchRes = await fetch(`/api/search?q=${encodeURIComponent(args.query || '')}&source=${searchSource}`);
            let searchData;
            const text = await searchRes.text();
            try {
              searchData = JSON.parse(text);
            } catch (e) {
              console.error('Failed to parse search data:', text.substring(0, 100));
            }
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: searchData && searchData.length > 0 ? JSON.stringify(searchData.slice(0, 3)) : `No results found for "${args.query}".`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'open_add_modal') {
            setIsAddModalOpen(true);
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Successfully opened the add asset modal.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'close_add_modal') {
            setIsAddModalOpen(false);
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Successfully closed the add asset modal.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else if (toolCall.function.name === 'close_chat') {
            setIsChatOpen(false);
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Successfully closed the chat window.`,
              thoughtSignature: toolCallMessage.thoughtSignature
            });
          } else {
            toolResponses.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Unknown tool: ${toolCall.function.name}`
            });
          }
        }

        currentMessages.push(...toolResponses);
        setChatMessages(prev => [...prev, toolCallMessage, ...toolResponses]);
        
        response = await callOpenRouter([systemPrompt, ...currentMessages], tools);
        if (!response.choices || response.choices.length === 0) {
          throw new Error(response.error?.message || 'The AI model returned an empty response. It might be overloaded or unavailable.');
        }
        message = response.choices[0].message;
      }

      if (message.content !== null || message.thought !== undefined || message.tool_calls) {
        setChatMessages(prev => [...prev, { 
          role: 'assistant', 
          content: message.content || '', 
          thought: message.thought,
          thoughtSignature: message.thoughtSignature,
          model: response.model 
        }]);
      }
    } catch (error: any) {
      console.error("AI Error:", error);
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setIsAiTyping(false);
    }
  };

  const portfolioStats = assets.reduce((acc, asset) => {
    const priceData = prices[asset.symbol];
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = hasPrice ? priceData.regularMarketPrice : asset.entryPrice;
    
    let currentCurrency;
    if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
    
    let assetCurrency = asset.currency || guessCurrency(asset.symbol);
    const entryPriceConverted = getConvertedPrice(asset.entryPrice, assetCurrency);
    
    const currentValue = currentPrice * asset.quantity;
    const investedValue = entryPriceConverted * asset.quantity;
    
    acc.currentValue += currentValue;
    acc.investedValue += investedValue;
    
    return acc;
  }, { currentValue: 0, investedValue: 0 });

  const totalProfitLoss = portfolioStats.currentValue - portfolioStats.investedValue;
  const totalProfitLossPercent = portfolioStats.investedValue > 0 ? (totalProfitLoss / portfolioStats.investedValue) * 100 : 0;

  const normalizeCategory = (category: string) => {
    if (!category) return 'Unknown';
    const upper = category.toUpperCase();
    if (upper === 'EQUITY') return 'Equities';
    if (upper === 'MUTUALFUND') return 'Mutual Funds';
    if (upper === 'CRYPTOCURRENCY' || upper === 'CRYPTO') return 'Crypto';
    if (upper === 'DEBT' || upper === 'FIXED INCOME') return 'Fixed Income';
    if (upper === 'CASH') return 'Cash';
    return category;
  };

  const allocationData = assets.reduce((acc: any[], asset) => {
    const priceData = prices[asset.symbol];
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = hasPrice ? priceData.regularMarketPrice : asset.entryPrice;
    
    let currentCurrency;
    if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
    const value = currentPrice * asset.quantity;
    
    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    
    if ((topCategory === 'Mutual Funds' || topCategory === 'ETF') && fundHoldings[asset.symbol]?.assetAllocation) {
      const alloc = fundHoldings[asset.symbol].assetAllocation;
      const totalAlloc = (alloc.stockPosition || 0) + (alloc.bondPosition || 0) + (alloc.cashPosition || 0) + (alloc.otherPosition || 0) + (alloc.preferredPosition || 0) + (alloc.convertiblePosition || 0);
      
      if (totalAlloc > 0) {
        const addValue = (cat: string, pct: number) => {
          if (pct <= 0) return;
          const normalizedPct = totalAlloc > 1.5 ? pct / 100 : pct;
          const val = value * normalizedPct;
          const existing = acc.find(item => item.name === cat);
          if (existing) {
            existing.value += val;
            existing.constituents = existing.constituents || [];
            existing.constituents.push({ name: asset.name, symbol: asset.symbol, value: val });
          } else {
            acc.push({ name: cat, value: val, constituents: [{ name: asset.name, symbol: asset.symbol, value: val }] });
          }
        };
        
        addValue('Equities', alloc.stockPosition || 0);
        addValue('Fixed Income', alloc.bondPosition || 0);
        addValue('Cash', alloc.cashPosition || 0);
        addValue('Other', (alloc.otherPosition || 0) + (alloc.preferredPosition || 0) + (alloc.convertiblePosition || 0));
        return acc;
      }
    }
    
    let finalCategory = topCategory;
    if (finalCategory === 'Mutual Funds') {
      const catName = (fundHoldings[asset.symbol]?.categoryName || '').toLowerCase();
      if (catName.includes('debt') || catName.includes('bond') || catName.includes('liquid') || catName.includes('fixed')) {
        finalCategory = 'Fixed Income';
      } else {
        finalCategory = 'Equities'; // Fallback if no allocation data and not obviously debt
      }
    }

    const existingType = acc.find(item => item.name === finalCategory);
    if (existingType) {
      existingType.value += value;
      existingType.constituents = existingType.constituents || [];
      existingType.constituents.push({ name: asset.name, symbol: asset.symbol, value: value });
    } else {
      acc.push({ name: finalCategory, value, constituents: [{ name: asset.name, symbol: asset.symbol, value: value }] });
    }
    return acc;
  }, []);

  const totalCurrentValue = allocationData.reduce((sum, item) => sum + item.value, 0);
  
  const allCategories = Array.from(new Set([
    ...Object.keys(idealAllocation),
    ...allocationData.map(item => item.name)
  ]));

  const allocationAnalysis = allCategories.map(category => {
    const currentItem = allocationData.find(item => item.name === category);
    const currentValue = currentItem ? currentItem.value : 0;
    const currentPercentage = totalCurrentValue > 0 ? (currentValue / totalCurrentValue) * 100 : 0;
    const idealPercentage = idealAllocation[category] || 0;
    const diffPercentage = currentPercentage - idealPercentage;
    const diffValue = (diffPercentage / 100) * totalCurrentValue;
    const constituents = currentItem && currentItem.constituents ? currentItem.constituents.sort((a: any, b: any) => b.value - a.value) : [];
    
    return {
      category,
      currentValue,
      currentPercentage,
      idealPercentage,
      diffPercentage,
      diffValue,
      constituents
    };
  }).sort((a, b) => b.currentValue - a.currentValue);

  const underlyingExposure: Record<string, { 
    symbol: string, 
    name: string, 
    value: number, 
    type: string, 
    marketCap?: number, 
    currency?: string,
    marketCapCategory?: string
  }> = {};

  const getCapCategory = (name: string, categoryName?: string) => {
    const combined = `${name} ${categoryName || ''}`.toLowerCase();
    if (combined.includes('large cap') || combined.includes('bluechip') || combined.includes('top 100') || combined.includes('nifty 50') || combined.includes('sensex') || combined.includes('large & mid cap')) return 'Large Cap';
    if (combined.includes('mid cap') || combined.includes('midcap') || combined.includes('nifty next 50')) return 'Mid Cap';
    if (combined.includes('small cap') || combined.includes('smallcap')) return 'Small Cap';
    return null;
  };

  console.log(`Calculating exposure for ${assets.length} assets. fundHoldings keys:`, Object.keys(fundHoldings));

  assets.forEach(asset => {
    const priceData = prices[asset.symbol];
    const hasPrice = priceData?.regularMarketPrice != null;
    const currentPriceRaw = hasPrice ? priceData.regularMarketPrice : asset.entryPrice;
    
    let currentCurrency;
    if (hasPrice) {
      currentCurrency = priceData.currency || guessCurrency(asset.symbol);
      if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
    } else {
      currentCurrency = asset.currency || guessCurrency(asset.symbol);
    }
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
    const totalValue = currentPrice * asset.quantity;

    const fundData = fundHoldings[asset.symbol];
    const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
    
    if (holdings && holdings.length > 0) {
      let accountedPercent = 0;
      holdings.forEach((h: any) => {
        const percent = h.holdingPercent; 
        accountedPercent += percent;
        const value = totalValue * percent;
        
        if (underlyingExposure[h.symbol]) {
          underlyingExposure[h.symbol].value += value;
        } else {
          underlyingExposure[h.symbol] = {
            symbol: h.symbol,
            name: h.holdingName,
            value: value,
            type: 'EQUITY',
            marketCap: prices[h.symbol]?.marketCap,
            currency: prices[h.symbol]?.currency || 'INR',
            marketCapCategory: getCapCategory(h.holdingName) || undefined
          };
        }
      });
      
      const remainingPercent = Math.max(0, 1 - accountedPercent);
      if (remainingPercent > 0) {
        const remKey = `OTHER_${asset.symbol}`;
        underlyingExposure[remKey] = {
          symbol: remKey,
          name: `Other (${asset.name})`,
          value: totalValue * remainingPercent,
          type: 'OTHER',
          marketCapCategory: getCapCategory(asset.name, fundData?.categoryName) || undefined
        };
      }
    } else {
      if (underlyingExposure[asset.symbol]) {
        underlyingExposure[asset.symbol].value += totalValue;
      } else {
        underlyingExposure[asset.symbol] = {
          symbol: asset.symbol,
          name: asset.name,
          value: totalValue,
          type: asset.type,
          marketCap: priceData?.marketCap,
          currency: currentCurrency,
          marketCapCategory: getCapCategory(asset.name, fundData?.categoryName) || undefined
        };
      }
    }
  });

  const marketCapAllocation = {
    'Large Cap': 0,
    'Mid Cap': 0,
    'Small Cap': 0,
    'Other / Uncategorized': 0
  };

  Object.values(underlyingExposure).forEach(exp => {
    // Only include equity assets for market cap exposure
    if (exp.type !== 'EQUITY') return;

    // Prioritize actual market cap if available
    if (exp.marketCap) {
      const capInUsd = exp.currency === 'INR' ? exp.marketCap / usdToInr : exp.marketCap;
      if (capInUsd >= 10_000_000_000) marketCapAllocation['Large Cap'] += exp.value;
      else if (capInUsd >= 2_000_000_000) marketCapAllocation['Mid Cap'] += exp.value;
      else marketCapAllocation['Small Cap'] += exp.value;
      return;
    }

    const category = exp.marketCapCategory || getCapCategory(exp.name);
    
    if (category === 'Large Cap' || exp.symbol === 'LARGE_CAP') {
      marketCapAllocation['Large Cap'] += exp.value;
    } else if (category === 'Mid Cap' || exp.symbol === 'MID_CAP') {
      marketCapAllocation['Mid Cap'] += exp.value;
    } else if (category === 'Small Cap' || exp.symbol === 'SMALL_CAP') {
      marketCapAllocation['Small Cap'] += exp.value;
    } else {
      marketCapAllocation['Other / Uncategorized'] += exp.value;
    }
  });

  const marketCapData = Object.entries(marketCapAllocation)
    .filter(([_, value]) => value > 0)
    .map(([name, value]) => ({ name, value }));
    
  const topUnderlying = Object.values(underlyingExposure)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-zinc-200 dark:border-zinc-800">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <PieChartIcon className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Asset Allocation Tracker</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mb-8">Sign in to manage your assets, analyze your allocation, and get AI-powered insights.</p>
          <button
            onClick={signInWithGoogle}
            className="w-full flex items-center justify-center gap-3 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 px-6 py-3 rounded-xl font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        
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
              onClick={() => {
                fetchPrices();
                // Clear loading state to allow re-fetching holdings
                assets.forEach(asset => {
                  if (asset.type === 'MUTUALFUND' || asset.type === 'ETF') {
                    loadingHoldings.current[asset.symbol] = false;
                    // Also clear errors for this symbol
                    setHoldingsErrors(prev => {
                      const updated = { ...prev };
                      delete updated[asset.symbol];
                      return updated;
                    });
                  }
                });
                // Force re-render to trigger holdings useEffect
                setAssets([...assets]);
              }}
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
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: any) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {allocationData.map((entry, index) => {
                    const total = allocationData.reduce((sum, item) => sum + item.value, 0);
                    const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                    return (
                      <div key={entry.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                          <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[100px] sm:max-w-[120px]">{entry.name}</span>
                        </div>
                        <div className="font-medium whitespace-nowrap">
                          ₹{entry.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          <span className="text-zinc-400 ml-1.5 font-normal text-xs">
                            ({percent}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
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
                          <Cell key={`cell-${index}`} fill={COLORS[(index + 3) % COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        formatter={(value: any) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {marketCapData.map((entry, index) => {
                    const total = marketCapData.reduce((sum, item) => sum + item.value, 0);
                    const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                    return (
                      <div key={entry.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[(index + 3) % COLORS.length] }} />
                          <span className="text-zinc-600 dark:text-zinc-400 truncate max-w-[100px] sm:max-w-[120px]">{entry.name}</span>
                        </div>
                        <div className="font-medium whitespace-nowrap">
                          ₹{entry.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          <span className="text-zinc-400 ml-1.5 font-normal text-xs">
                            ({percent}%)
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                Add equities to see market cap
              </div>
            )}
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
                  {allocationAnalysis.map((item) => (
                    <Fragment key={item.category}>
                      <tr 
                        className={`hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors ${item.constituents && item.constituents.length > 0 ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          if (item.constituents && item.constituents.length > 0) {
                            setExpandedCategories(prev => ({ ...prev, [item.category]: !prev[item.category] }));
                          }
                        }}
                      >
                        <td className="px-6 py-4 font-medium flex items-center gap-2">
                          {item.constituents && item.constituents.length > 0 && (
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
                      {expandedCategories[item.category] && item.constituents && item.constituents.length > 0 && (
                        <tr className="bg-zinc-50/50 dark:bg-zinc-900/20">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="pl-6 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-2">
                              {item.constituents.map((constituent: any, idx: number) => (
                                <div key={idx} className="flex justify-between text-sm">
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
                  {assets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                        No assets added yet. Click &quot;Add Asset&quot; to get started.
                      </td>
                    </tr>
                  ) : (
                    sortedAssets.map((asset) => {
                      const priceData = prices[asset.symbol];
                      const hasPrice = priceData?.regularMarketPrice != null;
                      const currentPriceRaw = hasPrice ? priceData.regularMarketPrice : asset.entryPrice;
                      
                      let currentCurrency;
                      if (hasPrice) {
                        currentCurrency = priceData.currency || guessCurrency(asset.symbol);
                        if (typeof asset.symbol === 'string' && asset.symbol.includes('-USD') && currentCurrency === 'INR') currentCurrency = 'USD';
                      } else {
                        currentCurrency = asset.currency || guessCurrency(asset.symbol);
                      }
                      
                      const assetCurrency = asset.currency || guessCurrency(asset.symbol);
                      
                      const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
                      const entryPrice = getConvertedPrice(asset.entryPrice, assetCurrency);
                      
                      const currentValue = currentPrice * asset.quantity;
                      const investedValue = entryPrice * asset.quantity;
                      const pnl = currentValue - investedValue;
                      const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
                      
                      const getMarketCapCategory = (marketCap?: number) => {
                        if (!marketCap) return 'N/A';
                        // Large Cap: > 20,000 Cr INR (200,000,000,000)
                        // Mid Cap: 5,000 Cr - 20,000 Cr INR (50,000,000,000 - 200,000,000,000)
                        // Small Cap: < 5,000 Cr INR (< 50,000,000,000)
                        if (marketCap > 200000000000) return 'Large Cap';
                        if (marketCap > 50000000000) return 'Mid Cap';
                        return 'Small Cap';
                      };
                      
                      return (
                        <tr key={asset.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-medium text-zinc-900 dark:text-zinc-100">{asset.name}</div>
                            <div className="text-xs text-zinc-500 mt-1">
                              {asset.symbol} &bull; {asset.categoryPath ? asset.categoryPath.join(' > ') : normalizeCategory(asset.type)} &bull; {getMarketCapCategory(priceData?.marketCap)}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right font-medium">
                            {asset.quantity.toLocaleString('en-IN')}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="text-zinc-900 dark:text-zinc-100">{asset.entryPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                            <div className="text-xs text-zinc-500">{asset.currency || currentCurrency}</div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {priceData ? (
                              <>
                                <div className="text-zinc-900 dark:text-zinc-100">{currentPriceRaw.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                                <div className="text-xs text-zinc-500">{currentCurrency}</div>
                              </>
                            ) : (
                              <span className="text-zinc-400 text-xs">Loading...</span>
                            )}
                          </td>
                          <td className="px-6 py-4 text-right font-medium text-zinc-900 dark:text-zinc-100">
                            ₹{currentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className={`font-medium ${pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                              {pnl >= 0 ? '+' : ''}₹{pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                            </div>
                            <div className={`text-xs ${pnl >= 0 ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-red-600/80 dark:text-red-400/80'}`}>
                              {pnl >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                            </div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex justify-center gap-1">
                              <button 
                                onClick={() => handleEditAsset(asset)}
                                className="p-2 text-zinc-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-lg transition-colors"
                                title="Edit Asset"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button 
                                onClick={() => handleDeleteAsset(asset.id)}
                                className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                                title="Remove Asset"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
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
                    <li key={item.symbol + idx} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex justify-between items-center">
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
      </div>

      {/* Add Asset Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] border border-zinc-200 dark:border-zinc-800">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                {editingAssetId ? 'Update Asset' : 'Add Asset'}
              </h2>
              <button 
                onClick={() => {
                  setIsAddModalOpen(false);
                  resetForm();
                }} 
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            
            <div className="p-5 overflow-y-auto space-y-5">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Search Asset</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input 
                    type="text" 
                    className="w-full pl-9 pr-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                    placeholder="e.g. Reliance, TCS, BTC-USD, Gold"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (selectedResult) setSelectedResult(null);
                    }}
                  />
                </div>
                
                {isSearching && <div className="text-sm text-zinc-500 mt-2 px-1">Searching...</div>}
                
                {searchResults.length > 0 && !selectedResult && (
                  <ul className="mt-2 border border-zinc-200 dark:border-zinc-700 rounded-xl max-h-48 overflow-y-auto bg-white dark:bg-zinc-950 shadow-sm divide-y divide-zinc-100 dark:divide-zinc-800">
                    {searchResults.map(res => (
                      <li 
                        key={res.symbol} 
                        className="px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer flex justify-between items-center transition-colors"
                        onClick={() => {
                          setSelectedResult(res);
                          setSearchQuery(res.shortname || res.longname || res.symbol);
                          setSearchResults([]);
                        }}
                      >
                        <div className="overflow-hidden pr-2">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{res.shortname || res.longname}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">{res.exchDisp} &bull; {res.typeDisp}</div>
                        </div>
                        <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md whitespace-nowrap">
                          {res.symbol}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedResult && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl">
                  <div className="flex justify-between items-center">
                    <div className="overflow-hidden pr-2">
                      <div className="font-medium text-blue-900 dark:text-blue-100 truncate">{selectedResult.shortname || selectedResult.longname}</div>
                      <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">{selectedResult.symbol}</div>
                    </div>
                    <button 
                      onClick={() => {
                        setSelectedResult(null);
                        setSearchQuery('');
                        setEditingAssetId(null);
                        setQuantity('');
                        setEntryPrice('');
                      }}
                      className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium whitespace-nowrap"
                    >
                      Change
                    </button>
                  </div>
                  
                  {assets.find(a => a.symbol === selectedResult.symbol) && !editingAssetId && (
                    <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg">
                      <div className="flex items-start gap-2">
                        <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                        </div>
                        <div className="flex-1">
                          <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">This asset is already in your portfolio.</p>
                          
                          {quantity && entryPrice && !isNaN(parseFloat(quantity)) && !isNaN(parseFloat(entryPrice)) ? (
                            <div className="mt-2 space-y-2">
                              <div className="text-[10px] text-amber-700 dark:text-amber-400 uppercase tracking-wider font-bold">Projected Average</div>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded border border-amber-100 dark:border-amber-900/30">
                                  <div className="text-[10px] text-zinc-500">New Quantity</div>
                                  <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                    {(assets.find(a => a.symbol === selectedResult.symbol)?.quantity || 0) + parseFloat(quantity)}
                                  </div>
                                </div>
                                <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded border border-amber-100 dark:border-amber-900/30">
                                  <div className="text-[10px] text-zinc-500">New Avg Price</div>
                                  <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                    {(() => {
                                      const existing = assets.find(a => a.symbol === selectedResult.symbol);
                                      if (!existing) return '0';
                                      
                                      const newQty = parseFloat(quantity);
                                      const newPrice = parseFloat(entryPrice);
                                      
                                      if (existing.currency === entryCurrency) {
                                        const avg = (existing.quantity * existing.entryPrice + newQty * newPrice) / (existing.quantity + newQty);
                                        return `${avg.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${entryCurrency}`;
                                      } else {
                                        const existingInInr = getConvertedPrice(existing.entryPrice, existing.currency || guessCurrency(existing.symbol));
                                        const newInInr = getConvertedPrice(newPrice, entryCurrency);
                                        const avgInInr = (existing.quantity * existingInInr + newQty * newInInr) / (existing.quantity + newQty);
                                        return `₹${avgInInr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
                                      }
                                    })()}
                                  </div>
                                </div>
                              </div>
                              <button 
                                onClick={handleMergeAsset}
                                className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                              >
                                Merge & Average
                              </button>
                            </div>
                          ) : (
                            <button 
                              onClick={() => {
                                const existing = assets.find(a => a.symbol === selectedResult.symbol);
                                if (existing) {
                                  setEditingAssetId(existing.id);
                                  setQuantity(existing.quantity.toString());
                                  setEntryPrice(existing.entryPrice.toString());
                                }
                              }}
                              className="mt-1 text-xs text-amber-700 dark:text-amber-300 underline hover:text-amber-900 dark:hover:text-amber-100 font-semibold"
                            >
                              Modify existing entry instead?
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {editingAssetId && (
                    <div className="mt-3 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-lg flex items-center gap-2">
                      <div className="text-green-600 dark:text-green-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                      </div>
                      <p className="text-xs text-green-800 dark:text-green-200 font-medium">Modifying existing entry</p>
                    </div>
                  )}
                </div>
              )}

              {selectedResult && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Quantity</label>
                    <input 
                      type="number" 
                      step="any"
                      min="0"
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      value={quantity}
                      onChange={(e) => setQuantity(e.target.value)}
                      placeholder="e.g. 10"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Entry Price</label>
                    <div className="relative">
                      <input 
                        type="number" 
                        step="any"
                        min="0"
                        className="w-full pl-4 pr-20 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                        value={entryPrice}
                        onChange={(e) => setEntryPrice(e.target.value)}
                        placeholder="e.g. 1500.50"
                      />
                      <div className="absolute right-1.5 top-1.5 bottom-1.5 flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
                        <button
                          onClick={() => setEntryCurrency('INR')}
                          className={`px-2 text-[10px] font-bold rounded-md transition-all ${entryCurrency === 'INR' ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                        >
                          INR
                        </button>
                        <button
                          onClick={() => setEntryCurrency('USD')}
                          className={`px-2 text-[10px] font-bold rounded-md transition-all ${entryCurrency === 'USD' ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                        >
                          USD
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-3">
                <button 
                  onClick={() => {
                    setIsAddModalOpen(false);
                    resetForm();
                  }}
                  className="px-5 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl font-medium transition-colors"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAddAsset}
                  disabled={!selectedResult || !quantity || !entryPrice}
                  className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {editingAssetId ? 'Update Asset' : 'Add Asset'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-zinc-200 dark:border-zinc-800">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Settings</h2>
              <button onClick={() => setIsSettingsOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-6">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Stock Search Source</label>
                <select
                  value={searchSource}
                  onChange={(e) => {
                    const val = e.target.value as 'indianapi' | 'yahoo' | 'newapi';
                    setSearchSource(val);
                    syncToDb({ settings: { searchSource: val } });
                  }}
                  className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                >
                  <option value="indianapi">IndianAPI</option>
                  <option value="yahoo">Yahoo Finance</option>
                  <option value="newapi">New API (GitHub)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">AI Provider</label>
                <select
                  value={aiProvider}
                  onChange={(e) => {
                    const val = e.target.value as 'openrouter' | 'google';
                    setAiProvider(val);
                    syncToDb({ settings: { aiProvider: val } });
                  }}
                  className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="google">Google Gemini (Built-in)</option>
                </select>
              </div>

              {aiProvider === 'openrouter' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">OpenRouter API Key</label>
                    <input 
                      type="password" 
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      placeholder="sk-or-v1-..."
                      defaultValue={openRouterKey}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveOpenRouterKey(e.currentTarget.value);
                      }}
                      onBlur={(e) => saveOpenRouterKey(e.target.value)}
                    />
                    <p className="text-xs text-zinc-500 mt-2">
                      Required to use the AI Assistant. Get one at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">openrouter.ai</a>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">AI Model</label>
                    <div className="flex flex-col gap-2">
                      <select
                        value={availableModels.some(m => m.id === selectedModel) || selectedModel === 'meta-llama/llama-3.3-70b-instruct:free' ? selectedModel : 'custom'}
                        onChange={(e) => {
                          if (e.target.value === 'custom') {
                            setSelectedModel('');
                            syncToDb({ settings: { openrouterModel: '' } });
                          } else {
                            setSelectedModel(e.target.value);
                            syncToDb({ settings: { openrouterModel: e.target.value } });
                          }
                        }}
                        className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                      >
                        <option value="meta-llama/llama-3.3-70b-instruct:free">Meta Llama 3.3 70B (Free, Best for Tools)</option>
                        {availableModels.map(model => (
                          <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                        <option value="custom">Custom Model...</option>
                      </select>
                      
                      {(!availableModels.some(m => m.id === selectedModel) && selectedModel !== 'meta-llama/llama-3.3-70b-instruct:free') && (
                        <input
                          type="text"
                          value={selectedModel}
                          onChange={(e) => {
                            setSelectedModel(e.target.value);
                            syncToDb({ settings: { openrouterModel: e.target.value } });
                          }}
                          placeholder="e.g., anthropic/claude-3-opus"
                          className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                          autoFocus
                        />
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                      Select a free model from the list or choose &quot;Custom Model...&quot; to type any OpenRouter model ID.
                    </p>
                  </div>
                </>
              )}

              {aiProvider === 'google' && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Gemini Model</label>
                  <select
                    value={googleModel}
                    onChange={(e) => {
                      setGoogleModel(e.target.value);
                      syncToDb({ settings: { googleModel: e.target.value } });
                    }}
                    className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                  >
                    <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (Fast & Efficient)</option>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Advanced Reasoning)</option>
                    <option value="gemini-flash-latest">Gemini Flash (Legacy Stable)</option>
                  </select>
                  <p className="text-xs text-zinc-500 mt-2">
                    Uses the built-in Gemini API key provided by the platform.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Allocation Settings Modal */}
      {isAllocationSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-zinc-200 dark:border-zinc-800">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
                <Target className="w-5 h-5 text-blue-500" />
                Ideal Asset Allocation
              </h2>
              <button onClick={() => setIsAllocationSettingsOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-6">
              <div>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
                  Set your target percentage for each asset category. This helps track where your portfolio needs rebalancing.
                </p>
                <div className="space-y-3">
                  {Object.entries(idealAllocation).map(([category, percentage]) => (
                    <div key={category} className="flex items-center gap-3">
                      <label className="w-1/3 text-sm text-zinc-600 dark:text-zinc-400">{category}</label>
                      <input
                        type="number"
                        value={percentage}
                        onChange={(e) => {
                          const newAlloc = { ...idealAllocation, [category]: Number(e.target.value) };
                          setIdealAllocation(newAlloc);
                          syncToDb({ settings: { idealAllocation: newAlloc } });
                        }}
                        className="w-2/3 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      />
                      <button
                        onClick={() => {
                          const newAlloc = { ...idealAllocation };
                          delete newAlloc[category];
                          setIdealAllocation(newAlloc);
                          syncToDb({ settings: { idealAllocation: newAlloc } });
                        }}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 mt-2">
                    <input
                      type="text"
                      id="newCategoryName"
                      placeholder="New Category"
                      className="w-1/2 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                    />
                    <button
                      onClick={() => {
                        const input = document.getElementById('newCategoryName') as HTMLInputElement;
                        if (input.value) {
                          const newAlloc = { ...idealAllocation, [input.value]: 0 };
                          setIdealAllocation(newAlloc);
                          syncToDb({ settings: { idealAllocation: newAlloc } });
                          input.value = '';
                        }
                      }}
                      className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                    >
                      Add
                    </button>
                  </div>
                  <div className="text-xs text-zinc-500 mt-2">
                    Total: {Object.values(idealAllocation).reduce((a, b) => a + b, 0)}% (Should be 100%)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Chat Widget */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
        {isChatOpen && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-80 sm:w-96 h-[500px] max-h-[70vh] mb-4 border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
            <div className="p-4 bg-blue-600 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                <h3 className="font-semibold">AI Assistant</h3>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={scrollToTop} className="text-blue-100 hover:text-white transition-colors" title="Scroll to top">
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button onClick={startNewChat} className="text-blue-100 hover:text-white transition-colors" title="New chat">
                  <MessageSquarePlus className="w-4 h-4" />
                </button>
                <button onClick={() => setIsChatOpen(false)} className="text-blue-100 hover:text-white transition-colors ml-1" title="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            
            <div 
              ref={chatContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-50 dark:bg-zinc-950/50"
            >
              {chatMessages.filter(m => m.role !== 'system' && m.role !== 'tool' && m.content).map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white rounded-br-sm' 
                      : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 rounded-bl-sm shadow-sm'
                  }`}>
                    {msg.content}
                  </div>
                  {msg.model && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 px-1">
                      by {msg.model}
                    </span>
                  )}
                </div>
              ))}
              {isAiTyping && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm flex gap-1">
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-zinc-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            
            <form onSubmit={handleAiCommand} className="p-3 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 flex gap-2">
              <input 
                type="text" 
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="Ask AI to add or remove assets..."
                className="flex-1 px-3 py-2 bg-zinc-100 dark:bg-zinc-800 border-transparent focus:bg-white dark:focus:bg-zinc-950 border focus:border-blue-500 rounded-xl outline-none text-sm transition-all"
              />
              <button 
                type="submit"
                disabled={!aiInput.trim() || isAiTyping}
                className="p-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl disabled:opacity-50 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
        
        <button 
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
        >
          {isChatOpen ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {assetToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-zinc-200 dark:border-zinc-800">
            <div className="p-5">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Delete Asset</h2>
              <p className="text-zinc-600 dark:text-zinc-400 mt-2">Are you sure you want to delete this asset? This action cannot be undone.</p>
            </div>
            <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
              <button 
                onClick={() => setAssetToDelete(null)}
                className="px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
