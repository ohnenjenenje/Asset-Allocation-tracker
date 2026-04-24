'use client';

import { useState, useEffect, useCallback, useRef, Fragment, useMemo } from 'react';
import { Plus, Search, Trash2, RefreshCw, TrendingUp, TrendingDown, DollarSign, PieChart as PieChartIcon, BarChart3, List, MessageCircle, Settings, Target, X, Send, Bot, ArrowUp, ArrowDown, ArrowUpDown, MessageSquarePlus, ChevronUp, ChevronDown, ChevronRight, Pencil, Info, LogOut, Filter } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, Treemap, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { auth, db, signInWithGoogle, signInWithEmail, signUpWithEmail, sendPasswordResetEmail, logOut, handleFirestoreError, OperationType } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, setDoc, updateDoc, onSnapshot, getDoc } from 'firebase/firestore';
import Screener from '@/components/Screener';

type Asset = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  entryPrice: number;
  manualPrice?: number;
  manualSector?: string;
  currency: string;
  type: string;
  categoryPath?: string[];
  exchange?: string;
  isGroup?: boolean;
};

type PriceData = {
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

type ChatMessage = {
  role: string;
  content: string | null;
  thought?: string;
  thoughtSignature?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
  model?: string;
  isFallback?: boolean;
};

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

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
  const formatCompact = (val: number) => {
    if (val === undefined || val === null) return '₹0';
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
    if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
    if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
    return `₹${val.toFixed(0)}`;
  };

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
  const [assets, setAssets] = useState<Asset[]>([]);
  const [isFirestoreOffline, setIsFirestoreOffline] = useState(false);
  const [binanceAssets, setBinanceAssets] = useState<Asset[]>([]);
  const [coindcxAssets, setCoindcxAssets] = useState<Asset[]>([]);
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const pricesRef = useRef(prices);
  
  useEffect(() => {
    pricesRef.current = prices;
  }, [prices]);

  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({ key: 'currentValue', direction: 'desc' });
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualSector, setManualSector] = useState('');
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
  const [huggingFaceKey, setHuggingFaceKey] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState<{message: string, isError: boolean} | null>(null);
  const [isAllocationSettingsOpen, setIsAllocationSettingsOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({ 'Total Portfolio': true });
  const [expandedSymbols, setExpandedSymbols] = useState<Record<string, boolean>>({});
  const [expandedSectors, setExpandedSectors] = useState<Record<string, boolean>>({});
  const [expandedMarketCaps, setExpandedMarketCaps] = useState<Record<string, boolean>>({});
  const [expandedFunds, setExpandedFunds] = useState<Record<string, boolean>>({});
  const [manualFundModal, setManualFundModal] = useState<{ isOpen: boolean, symbol: string, name: string, holdings: { name: string, holdingPercent: number }[] } | null>(null);
  const [manualSectorModal, setManualSectorModal] = useState<{ isOpen: boolean, symbol: string, name: string, sectors: { sector: string, percentage: number }[] } | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: 'Hi! I can help you manage your portfolio. Try saying "Add 10 shares of Apple at $150" or "Remove Reliance".' }]);
  const [aiInput, setAiInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [aiProvider, setAiProvider] = useState<'openrouter' | 'google' | 'huggingface'>('google');
  const [searchSource, setSearchSource] = useState<'indianapi' | 'yahoo' | 'newapi' | 'tickertape'>('tickertape');
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState('meta-llama/llama-3.3-70b-instruct:free');
  const [googleModel, setGoogleModel] = useState('gemini-3.1-flash-lite-preview');
  const [huggingFaceModel, setHuggingFaceModel] = useState('google/gemma-2-27b-it');
  const [activeTab, setActiveTab] = useState<'portfolio' | 'screener'>('portfolio');

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isEmailLoginMode, setIsEmailLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [emailAuthInput, setEmailAuthInput] = useState('');
  const [passwordAuthInput, setPasswordAuthInput] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError('');
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Sign in failed:", error);
      setAuthError('Sign in with Google failed.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSigningIn) return;
    if (!emailAuthInput || !passwordAuthInput) {
      setAuthError('Please enter both email and password.');
      return;
    }
    setIsSigningIn(true);
    setAuthError('');
    try {
      if (isEmailLoginMode) {
        await signInWithEmail(emailAuthInput, passwordAuthInput);
      } else {
        await signUpWithEmail(emailAuthInput, passwordAuthInput);
      }
    } catch (err: any) {
      console.error("Email auth error:", err);
      if (err.code === 'auth/operation-not-allowed') {
        setAuthError('Email/Password sign in is disabled. Enable it in Firebase Console.');
      } else if (err.code === 'auth/invalid-credential') {
        setAuthError('Incorrect email or password.');
      } else if (err.code === 'auth/email-already-in-use') {
        setAuthError('Account already exists. Try logging in.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Password is too weak. Please use at least 6 characters.');
      } else {
        setAuthError(err.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSigningIn) return;
    if (!emailAuthInput) {
      setAuthError('Please enter your email address.');
      return;
    }
    setIsSigningIn(true);
    setAuthError('');
    try {
      await sendPasswordResetEmail(emailAuthInput);
      setAuthError('Password reset email sent. Please check your inbox.');
      setIsResetMode(false);
    } catch (err: any) {
      setAuthError('Failed to send reset email: ' + err.message);
    } finally {
      setIsSigningIn(false);
    }
  };

  const usdToInr = prices['INR=X']?.regularMarketPrice || 83;

  const guessCurrency = (symbol: string) => {
    if (!symbol || typeof symbol !== 'string') return 'INR';
    const upper = symbol.toUpperCase();
    if (upper.endsWith('.NS') || upper.endsWith('.BO')) return 'INR';
    if (upper.endsWith('.L')) return 'GBp';
    if (upper.includes('-USD')) return 'USD'; // Explicit crypto USD
    if (upper.includes('-')) return 'USD'; // Other crypto usually USD
    // Default to INR instead of USD when adding asset
    return 'INR';
  };

  const getConvertedPrice = (price: number, currency: string) => {
    if (currency === 'USD') return price * usdToInr;
    if (currency === 'GBp') return (price / 100) * 105; // Approx GBP to INR
    return price;
  };

  const normalizeCategory = (category?: string) => {
    if (!category) return 'Unknown';
    const upper = category.toUpperCase();
    if (upper === 'EQUITY' || upper === 'STOCK') return 'Equities';
    if (upper === 'MUTUALFUND' || upper === 'ETF') return 'Mutual Funds';
    if (upper === 'CRYPTOCURRENCY' || upper === 'CRYPTO') return 'Crypto';
    if (upper === 'DEBT' || upper === 'FIXED INCOME') return 'Fixed Income';
    if (upper === 'CASH') return 'Cash';
    return category;
  };

  const isSmallCrypto = (asset: Asset) => {
    const baseCat = normalizeCategory(asset.type);
    if (baseCat === 'Crypto') {
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
      
      const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
      const value = currentPrice * asset.quantity;
      if (value < 10) return true;
    }
    return false;
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
              huggingFaceKey,
              huggingFaceModel,
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

  useEffect(() => {
    if (!isAuthReady || !user) return;
    
    // Helper to generic exchange fetch
    const fetchExchange = async (url: string, setter: (assets: Asset[]) => void, exchangeName: string) => {
      let retries = 6;
      let success = false;
      
      while (retries > 0 && !success) {
        try {
          const res = await fetch(url).catch(e => {
            if (e.message.includes('fetch') || e.name === 'TypeError') {
               return { ok: false, status: 0, text: () => Promise.resolve('Failed to fetch') } as any;
            }
            throw e;
          });
          
          if (!res.ok) {
            const text = await res.text().catch(() => 'No body');
            
            // Special handling for temporary service unavailability
            if (res.status === 503 || res.status === 429 || text.includes('Starting Server') || text.includes('Failed to fetch') || res.status === 0) {
              const backoff = (7 - retries) * 4000; // Exponential-ish backoff
              console.log(`${exchangeName}: Status ${res.status} (Temporary), waiting ${backoff/1000}s... (${retries} left)`);
              await new Promise(r => setTimeout(r, backoff));
              retries--;
              continue;
            }
            
            console.warn(`${exchangeName} API status ${res.status}: ${text.substring(0, 100)}`);
            throw new Error(`Status ${res.status}`);
          }

          const contentType = res.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            const text = await res.text().catch(() => 'No body');
            if (text.includes('Starting Server')) {
              console.log(`${exchangeName}: Server starting, waiting...`);
              await new Promise(r => setTimeout(r, 8000));
              retries--;
              continue;
            }
            throw new Error(`Non-JSON content: ${contentType}`);
          }

          const data = await res.json();
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
            success = true;
          } else {
            console.error(`Failed to fetch ${exchangeName} assets:`, data.error);
            success = true; // Don't retry on logical errors
          }
        } catch (err: any) {
          console.error(`Fetch ${exchangeName} error (Attempt ${6 - retries}):`, err.message || err);
          retries--;
          if (retries > 0) await new Promise(r => setTimeout(r, 4000));
        }
      }
    };

    fetchExchange('/api/crypto/binance', setBinanceAssets, 'Binance');
    fetchExchange('/api/crypto/coindcx', setCoindcxAssets, 'CoinDCX');
  }, [user, isAuthReady]);

  useEffect(() => {
    if (!isAuthReady || !user) return;

    const userRef = doc(db, 'users', user.uid);
    const unsubscribe = onSnapshot(userRef, async (docSnap) => {
      setIsFirestoreOffline(false);
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
          if (data.settings.huggingFaceKey) setHuggingFaceKey(data.settings.huggingFaceKey);
          if (data.settings.huggingFaceModel) setHuggingFaceModel(data.settings.huggingFaceModel);
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
      // Suppress the benign "Disconnecting idle stream" warning which is common in idle serverless environments
      if (error.message.includes('Disconnecting idle stream') || error.message.includes('Timed out waiting for new targets')) {
        return;
      }
      
      console.warn("Firestore snapshot error detected:", error.message);
      if (error.message.includes('offline') || error.message.includes('backend') || error.message.includes('Internet connection')) {
        setIsFirestoreOffline(true);
      }
      // handleFirestoreError throws, so keep it last or wrapped if we want more logic
      try {
        handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
      } catch (e) {
        // Logged by handleFirestoreError
      }
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
        !fundHoldings[asset.symbol] && 
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
                   console.error('API Error fetching holdings for', asset.symbol, res.status, text.substring(0, 100));
               }
               return { holdings: [] };
            }
            
            try {
              return JSON.parse(text);
            } catch (e) {
              console.error('Failed to parse holdings data for', asset.symbol, ':', text.substring(0, 100));
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
            
            const fundData = {
              holdings: data.holdings || [],
              sectorWeightings: data.sectorWeightings || [],
              categoryName: data.categoryName || null,
              assetAllocation: data.assetAllocation || null,
              debug: data.debug || null
            };

            setFundHoldings(prev => {
              const updated = { 
                ...prev, 
                [asset.symbol]: fundData
              };
              return updated;
            });

            // Sync to DB outside of state update if we found something
            if (hasHoldings || hasSectors || data.categoryName || data.assetAllocation) {
              syncToDb({ fundHoldings: { ...fundHoldings, [asset.symbol]: fundData } });
            }
          })
          .catch(err => {
            console.error(`Holdings fetch failed for ${asset.symbol}`, err);
            setHoldingsErrors(prev => ({ ...prev, [asset.symbol]: err.message }));
          });
      }
    });
  }, [assets, fundHoldings]);

  const fetchPrices = useCallback(async (forceRefresh = false) => {
    if (assets.length === 0) return;
    
    setIsLoadingPrices(true);
    try {
      const symbolsSet = new Set<string>();
      assets.forEach(a => symbolsSet.add(a.symbol));
      // Binance assets are priced immediately on fetch, no need for Yahoo
      symbolsSet.add('INR=X');

      Object.values(fundHoldings).forEach(fundData => {
        const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
        holdings.forEach((h: any) => {
          if (h.symbol) symbolsSet.add(h.symbol);
        });
      });

      let symbols = Array.from(symbolsSet);
      
      if (!forceRefresh) {
        symbols = symbols.filter(s => !pricesRef.current[s]);
      }

      if (symbols.length === 0) {
        setIsLoadingPrices(false);
        return;
      }

      const newPrices: Record<string, PriceData> = {};
      
      const chunkSize = 8;
      for (let i = 0; i < symbols.length; i += chunkSize) {
        // Wait briefly between chunks
        if (i > 0) await new Promise(r => setTimeout(r, 600));
        
        const chunk = symbols.slice(i, i + chunkSize);
        
        let retries = 6; 
        let success = false;
        
        while (retries >= 0 && !success) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout per chunk
          
          try {
            const res = await fetch(`/api/price?symbols=${encodeURIComponent(chunk.join(','))}${forceRefresh ? '&refresh=true' : ''}`, {
              signal: controller.signal
            }).catch(e => {
              // Specifically handle "Failed to fetch" which is often a network/boot issue
              if (e.message.includes('fetch') || e.name === 'TypeError') {
                 return { ok: false, status: 0, text: () => Promise.resolve('Failed to fetch') } as any;
              }
              throw e;
            });
            clearTimeout(timeoutId);
            
            if (!res.ok) {
              const errBody = await res.text().catch(() => 'No body');
              if (errBody.includes('Failed to fetch') || errBody.includes('Starting Server') || res.status === 0) {
                console.log('Network error or server booting, waiting...');
                await new Promise(r => setTimeout(r, 9000));
                retries--;
                continue;
              }
              throw new Error(`Price API status ${res.status}: ${errBody.substring(0, 100)}`);
            }

            const contentType = res.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
              const text = await res.text();
              console.error(`Non-JSON content-type: ${contentType}. Body: ${text.substring(0, 200)}`);
              
              // If we see "Starting Server", it means the dev environment is booting up.
              // We should wait longer and retry.
              if (text.includes('Starting Server')) {
                console.log('Server is starting up, waiting before retry...');
                await new Promise(r => setTimeout(r, 9000));
                retries--;
                continue;
              }
              
              throw new Error(`Non-JSON content-type: ${contentType}`);
            }

            const data = await res.json();
            if (Array.isArray(data)) {
              data.forEach((item: any) => {
                newPrices[item.symbol] = {
                  symbol: item.symbol,
                  regularMarketPrice: item.regularMarketPrice,
                  currency: item.currency,
                  shortName: item.shortName || item.longName || item.symbol,
                  marketCap: item.marketCap,
                  quoteType: item.quoteType,
                  sector: item.sector,
                  source: item.source,
                  lastUpdated: Date.now()
                };
              });
              success = true;
            }
          } catch (err: any) {
            clearTimeout(timeoutId);
            const isTimeout = err.name === 'AbortError';
            console.error(`Attempt ${4 - retries} failed for chunk ${i} (Symbols: ${chunk.join(', ')}) (${isTimeout ? 'Timeout' : 'Error'}):`, err.message || err);
            
            retries--;
            if (retries >= 0) await new Promise(r => setTimeout(r, 3000)); // Increased backoff
          }
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

  const getBaseCryptoSymbol = (symbol: string) => {
    if (typeof symbol === 'string' && symbol.includes('-')) {
      const parts = symbol.split('-');
      if (['USD', 'INR', 'EUR', 'GBP', 'CAD', 'AUD'].includes(parts[parts.length - 1])) {
        return parts.slice(0, -1).join('-');
      }
    }
    return symbol;
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

  const mergedAssets = useMemo(() => [...assets, ...binanceAssets, ...coindcxAssets], [assets, binanceAssets, coindcxAssets]);

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
          const entryPrice = getConvertedPrice(item.entryPrice, assetCurrency);
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
        
        const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
        const assetCurrency = asset.currency || guessCurrency(asset.symbol);
        const entryPrice = asset.isGroup ? asset.entryPrice : getConvertedPrice(asset.entryPrice, assetCurrency);

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
    setManualPrice('');
    setManualSector('');
    setEntryCurrency('INR');
    setEditingAssetId(null);
  };

  const saveOpenRouterKey = (key: string) => {
    setOpenRouterKey(key);
    syncToDb({ settings: { openRouterKey: key } });
    setIsSettingsOpen(false);
  };

  const saveHuggingFaceKey = (key: string) => {
    setHuggingFaceKey(key);
    syncToDb({ settings: { huggingFaceKey: key } });
    setIsSettingsOpen(false);
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

  const callHuggingFace = async (messages: any[], tools: any[]) => {
    if (!huggingFaceKey) {
      throw new Error('Hugging Face API key is required. Please set it in Settings.');
    }

    const res = await fetch(`https://api-inference.huggingface.co/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${huggingFaceKey}`
      },
      body: JSON.stringify({
        model: huggingFaceModel,
        messages: messages,
        tools: tools,
        max_tokens: 1024
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HF Error (${res.status}): ${text.substring(0, 200)}`);
    }

    return await res.json();
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
          isFallback: false,
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
        isFallback: false,
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
    let isFallback = false;
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
            isFallback = true;
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
      const data = JSON.parse(text);
      return { ...data, model: currentModel, isFallback };
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
              manualPrice: { type: 'number', description: 'The manual price to override market price' },
              manualSector: { type: 'string', description: 'The manual sector to override or provide sector information' },
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
              entryPrice: { type: 'number', description: 'The new average purchase price per unit' },
              manualPrice: { type: 'number', description: 'The manual price to override market price' },
              manualSector: { type: 'string', description: 'The manual sector to override or provide sector information' }
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
      
      let response;
      if (aiProvider === 'google' || aiProvider === 'openrouter') {
        response = await callOpenRouter([systemPrompt, ...currentMessages], tools);
      } else {
        response = await callHuggingFace([systemPrompt, ...currentMessages], tools);
      }
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
                manualPrice: args.manualPrice,
                manualSector: args.manualSector,
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
                    entryPrice: args.entryPrice !== undefined ? args.entryPrice : a.entryPrice,
                    manualPrice: args.manualPrice !== undefined ? args.manualPrice : a.manualPrice,
                    manualSector: args.manualSector !== undefined ? args.manualSector : a.manualSector
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
            await fetchPrices(true);
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
        
        if (aiProvider === 'google' || aiProvider === 'openrouter') {
          response = await callOpenRouter([systemPrompt, ...currentMessages], tools);
        } else {
          response = await callHuggingFace([systemPrompt, ...currentMessages], tools);
        }
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
          model: response.model,
          isFallback: response.isFallback
        }]);
      }
    } catch (error: any) {
      console.error("AI Error:", error);
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setIsAiTyping(false);
    }
  };

  const portfolioStats = mergedAssets.reduce((acc, asset) => {
    const category = normalizeCategory(asset.type);
    if (!acc.byCategory[category]) {
      acc.byCategory[category] = { quantity: 0, currentValue: 0, investedValue: 0 };
    }

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
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
    
    let assetCurrency = asset.currency || guessCurrency(asset.symbol);
    const entryPriceConverted = getConvertedPrice(asset.entryPrice, assetCurrency);
    
    const currentValue = currentPrice * asset.quantity;
    const investedValue = entryPriceConverted * asset.quantity;
    
    acc.currentValue += currentValue;
    acc.investedValue += investedValue;
    
    acc.byCategory[category].quantity += asset.quantity;
    acc.byCategory[category].currentValue += currentValue;
    acc.byCategory[category].investedValue += investedValue;

    if (isSmallCrypto(asset)) {
      acc.smallCryptoStats.quantity += asset.quantity;
      acc.smallCryptoStats.currentValue += currentValue;
      acc.smallCryptoStats.investedValue += investedValue;
    }
    
    return acc;
  }, { currentValue: 0, investedValue: 0, byCategory: {} as Record<string, { quantity: number; currentValue: number; investedValue: number; }>, smallCryptoStats: { quantity: 0, currentValue: 0, investedValue: 0 } });

  const totalProfitLoss = portfolioStats.currentValue - portfolioStats.investedValue;
  const totalProfitLossPercent = portfolioStats.investedValue > 0 ? (totalProfitLoss / portfolioStats.investedValue) * 100 : 0;

  const allocationData = mergedAssets.reduce((acc: any[], asset) => {
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
          const normalizedPct = pct / totalAlloc;
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
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
    const totalValue = currentPrice * asset.quantity;

    const fundData = fundHoldings[asset.symbol];
    const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
    
    if (holdings && holdings.length > 0) {
      let accountedPercent = 0;
      let totalHoldingPercent = holdings.reduce((sum: number, h: any) => sum + (h.holdingPercent || 0), 0);
      let isPercentageScale = totalHoldingPercent > 1.5;

      holdings.forEach((h: any) => {
        const percentRaw = h.holdingPercent || 0;
        const percent = isPercentageScale ? percentRaw / 100 : percentRaw;
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

  const marketCapAllocation: Record<string, { total: number, direct: number, indirect: number, constituents: { name: string, symbol: string, value: number, type: 'direct' | 'indirect', subHoldings?: {name: string, value: number}[], otherAllocations?: {name: string, value: number}[] }[] }> = {
    'Large Cap': { total: 0, direct: 0, indirect: 0, constituents: [] },
    'Mid Cap': { total: 0, direct: 0, indirect: 0, constituents: [] },
    'Small Cap': { total: 0, direct: 0, indirect: 0, constituents: [] },
    'Other / Uncategorized': { total: 0, direct: 0, indirect: 0, constituents: [] }
  };

  const addToMarketCap = (cap: string, value: number, isDirect: boolean, name: string, symbol: string, subHoldings?: {name: string, value: number}[], otherAllocations?: {name: string, value: number}[]) => {
    if (!marketCapAllocation[cap]) {
      marketCapAllocation[cap] = { total: 0, direct: 0, indirect: 0, constituents: [] };
    }
    marketCapAllocation[cap].total += value;
    if (isDirect) {
      marketCapAllocation[cap].direct += value;
    } else {
      marketCapAllocation[cap].indirect += value;
    }
    
    const existing = marketCapAllocation[cap].constituents.find(c => c.symbol === symbol);
    if (existing) {
      existing.value += value;
      if (subHoldings) {
        existing.subHoldings = [...(existing.subHoldings || []), ...subHoldings];
      }
      if (otherAllocations) {
        existing.otherAllocations = otherAllocations;
      }
    } else {
      marketCapAllocation[cap].constituents.push({ name, symbol, value, type: isDirect ? 'direct' : 'indirect', subHoldings, otherAllocations });
    }
  };

  assets.forEach(asset => {
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
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
    const totalValue = currentPrice * asset.quantity;

    // 1. Determine the Equity portion of this asset (matching Asset Allocation logic)
    let equityValue = 0;
    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    const fundData = fundHoldings[asset.symbol];
    
    if ((topCategory === 'Mutual Funds' || topCategory === 'ETF') && fundData?.assetAllocation) {
      const alloc = fundData.assetAllocation;
      const totalAlloc = (alloc.stockPosition || 0) + (alloc.bondPosition || 0) + (alloc.cashPosition || 0) + (alloc.otherPosition || 0) + (alloc.preferredPosition || 0) + (alloc.convertiblePosition || 0);
      if (totalAlloc > 0) {
        equityValue = totalValue * ((alloc.stockPosition || 0) / totalAlloc);
      }
    } else {
      let finalCategory = topCategory;
      if (finalCategory === 'Mutual Funds') {
        const catName = (fundData?.categoryName || '').toLowerCase();
        if (catName.includes('debt') || catName.includes('bond') || catName.includes('liquid') || catName.includes('fixed')) {
          finalCategory = 'Fixed Income';
        } else {
          finalCategory = 'Equities';
        }
      }
      if (finalCategory === 'Equities') {
        equityValue = totalValue;
      }
    }

    if (equityValue <= 0) return;

    // 2. Distribute the Equity value across Market Caps
    const holdings = Array.isArray(fundData) ? fundData : (fundData?.holdings || []);
    
    if (holdings && holdings.length > 0) {
      let mappedHoldingsValue = 0;
      let totalHoldingPercent = holdings.reduce((sum: number, h: any) => sum + (h.holdingPercent || 0), 0);
      let isPercentageScale = totalHoldingPercent > 1.5;

      const fundCapExposure: Record<string, { total: number, holdings: {name: string, value: number}[] }> = {};

      holdings.forEach((h: any) => {
        const percentRaw = h.holdingPercent || 0;
        const percent = isPercentageScale ? percentRaw / 100 : percentRaw;
        const holdingValue = totalValue * percent;
        
        // Only map equity holdings
        const hPriceData = prices[h.symbol];
        let cap = 'Other / Uncategorized';
        if (hPriceData?.marketCap) {
          const hCurrency = hPriceData.currency || 'INR';
          const capInUsd = hCurrency === 'INR' ? hPriceData.marketCap / usdToInr : hPriceData.marketCap;
          if (capInUsd >= 10_000_000_000) cap = 'Large Cap';
          else if (capInUsd >= 2_000_000_000) cap = 'Mid Cap';
          else cap = 'Small Cap';
        } else {
          const cat = getCapCategory(h.holdingName);
          if (cat) cap = cat;
        }

        if (!fundCapExposure[cap]) fundCapExposure[cap] = { total: 0, holdings: [] };
        fundCapExposure[cap].total += holdingValue;
        fundCapExposure[cap].holdings.push({ name: h.holdingName || h.symbol, value: holdingValue });
        
        mappedHoldingsValue += holdingValue;
      });

      const nonEquity = totalValue - equityValue;

      Object.entries(fundCapExposure).forEach(([cap, data]) => {
        const otherAllocations: {name: string, value: number}[] = [];
        Object.entries(fundCapExposure).forEach(([otherCap, otherData]) => {
          if (otherCap !== cap && otherData.total > 0) {
            otherAllocations.push({ name: otherCap, value: otherData.total });
          }
        });
        const unmappedEquity = Math.max(0, equityValue - mappedHoldingsValue);
        if (unmappedEquity > 0) otherAllocations.push({ name: 'Unmapped Equity', value: unmappedEquity });
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToMarketCap(cap, data.total, false, asset.name, asset.symbol, data.holdings, otherAllocations);
      });

      // Any remaining equity value that wasn't mapped via holdings goes to Uncategorized
      const unmappedEquity = Math.max(0, equityValue - mappedHoldingsValue);
      if (unmappedEquity > 0) {
        const otherAllocations: {name: string, value: number}[] = [];
        Object.entries(fundCapExposure).forEach(([otherCap, otherData]) => {
          if (otherData.total > 0) otherAllocations.push({ name: otherCap, value: otherData.total });
        });
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToMarketCap('Other / Uncategorized', unmappedEquity, false, `Unmapped Equity (${asset.name})`, `${asset.symbol}-unmapped`, undefined, otherAllocations);
      }
    } else {
      // Direct stock or fund with no holdings data
      let cap = 'Other / Uncategorized';
      const type = (asset.type || '').toUpperCase();
      const isDirect = type === 'EQUITY' || type === 'STOCK';
      
      if (priceData?.marketCap) {
        const capInUsd = currentCurrency === 'INR' ? priceData.marketCap / usdToInr : priceData.marketCap;
        if (capInUsd >= 10_000_000_000) cap = 'Large Cap';
        else if (capInUsd >= 2_000_000_000) cap = 'Mid Cap';
        else cap = 'Small Cap';
      } else {
        const cat = getCapCategory(asset.name, fundData?.categoryName);
        if (cat) cap = cat;
      }
      addToMarketCap(cap, equityValue, isDirect, asset.name, asset.symbol);
    }
  });

  const marketCapData = Object.entries(marketCapAllocation)
    .filter(([_, data]) => data.total > 0)
    .map(([name, data]) => ({ 
      name, 
      value: data.total,
      direct: data.direct,
      indirect: data.indirect,
      constituents: data.constituents.sort((a, b) => b.value - a.value)
    }));

  const sectorAllocation: Record<string, { total: number, direct: number, indirect: number, constituents: { name: string, symbol: string, value: number, type: 'direct' | 'indirect', otherAllocations?: {name: string, value: number}[] }[] }> = {};
  const sectorByMarketCap: Record<string, Record<string, number>> = {
    'Large Cap': {},
    'Mid Cap': {},
    'Small Cap': {},
    'Other / Uncategorized': {}
  };

  const addToSector = (sectorName: string, value: number, isDirect: boolean, name: string, symbol: string, otherAllocations?: {name: string, value: number}[]) => {
    if (!sectorAllocation[sectorName]) {
      sectorAllocation[sectorName] = { total: 0, direct: 0, indirect: 0, constituents: [] };
    }
    sectorAllocation[sectorName].total += value;
    if (isDirect) {
      sectorAllocation[sectorName].direct += value;
    } else {
      sectorAllocation[sectorName].indirect += value;
    }
    
    const existing = sectorAllocation[sectorName].constituents.find(c => c.symbol === symbol);
    if (existing) {
      existing.value += value;
      if (otherAllocations) {
        existing.otherAllocations = otherAllocations;
      }
    } else {
      sectorAllocation[sectorName].constituents.push({ name, symbol, value, type: isDirect ? 'direct' : 'indirect', otherAllocations });
    }
  };

  assets.forEach(asset => {
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
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
    const totalValue = currentPrice * asset.quantity;

    // 1. Determine the Equity portion of this asset
    let equityValue = 0;
    const topCategoryRaw = asset.categoryPath && asset.categoryPath.length > 0 ? asset.categoryPath[0] : asset.type;
    const topCategory = normalizeCategory(topCategoryRaw);
    const fundData = fundHoldings[asset.symbol];
    
    if ((topCategory === 'Mutual Funds' || topCategory === 'ETF') && fundData?.assetAllocation) {
      const alloc = fundData.assetAllocation;
      const totalAlloc = (alloc.stockPosition || 0) + (alloc.bondPosition || 0) + (alloc.cashPosition || 0) + (alloc.otherPosition || 0) + (alloc.preferredPosition || 0) + (alloc.convertiblePosition || 0);
      if (totalAlloc > 0) {
        equityValue = totalValue * ((alloc.stockPosition || 0) / totalAlloc);
      }
    } else {
      let finalCategory = topCategory;
      if (finalCategory === 'Mutual Funds') {
        const catName = (fundData?.categoryName || '').toLowerCase();
        if (catName.includes('debt') || catName.includes('bond') || catName.includes('liquid') || catName.includes('fixed')) {
          finalCategory = 'Fixed Income';
        } else {
          finalCategory = 'Equities';
        }
      }
      if (finalCategory === 'Equities') {
        equityValue = totalValue;
      }
    }

    if (equityValue <= 0) return; // Only allocate equity to sectors

    const sectors = fundData?.sectorWeightings || [];
    
    // Determine cap category for this asset
    let cap = 'Other / Uncategorized';
    const type = (asset.type || '').toUpperCase();
    if (type === 'EQUITY' || type === 'STOCK') {
       if (priceData?.marketCap) {
         const capInUsd = priceData.currency === 'INR' ? priceData.marketCap / usdToInr : priceData.marketCap;
         if (capInUsd >= 10_000_000_000) cap = 'Large Cap';
         else if (capInUsd >= 2_000_000_000) cap = 'Mid Cap';
         else cap = 'Small Cap';
       } else {
         cap = getCapCategory(asset.name) || 'Other / Uncategorized';
       }
    } else if (type === 'MUTUALFUND' || type === 'ETF') {
       cap = getCapCategory(asset.name, fundData?.categoryName) || 'Other / Uncategorized';
    }

    if (sectors.length > 0 && !asset.manualSector) {
      let mappedSectorValue = 0;
      sectors.forEach((s: any) => {
        mappedSectorValue += equityValue * ((s.percentage || 0) / 100);
      });
      
      const unmappedSector = Math.max(0, equityValue - mappedSectorValue);
      const nonEquity = totalValue - equityValue;

      sectors.forEach((s: any) => {
        const sectorName = s.sector || 'Other';
        const percent = (s.percentage || 0) / 100;
        const val = equityValue * percent;

        const otherAllocations: {name: string, value: number}[] = [];
        sectors.forEach((otherS: any) => {
          const otherSectorName = otherS.sector || 'Other';
          if (otherSectorName !== sectorName) {
            const otherVal = equityValue * ((otherS.percentage || 0) / 100);
            if (otherVal > 0) otherAllocations.push({ name: otherSectorName, value: otherVal });
          }
        });
        if (unmappedSector > 0) otherAllocations.push({ name: 'Unmapped Equity', value: unmappedSector });
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToSector(sectorName, val, false, asset.name, asset.symbol, otherAllocations);
        if (!sectorByMarketCap[cap]) sectorByMarketCap[cap] = {};
        sectorByMarketCap[cap][sectorName] = (sectorByMarketCap[cap][sectorName] || 0) + val;
      });

      if (unmappedSector > 0) {
        const sectorName = 'Other / Uncategorized';
        const otherAllocations: {name: string, value: number}[] = [];
        sectors.forEach((otherS: any) => {
          const otherVal = equityValue * ((otherS.percentage || 0) / 100);
          if (otherVal > 0) otherAllocations.push({ name: otherS.sector || 'Other', value: otherVal });
        });
        if (nonEquity > 0) otherAllocations.push({ name: 'Non-Equity / Debt', value: nonEquity });

        addToSector(sectorName, unmappedSector, false, `Unmapped Equity (${asset.name})`, `${asset.symbol}-unmapped`, otherAllocations);
        if (!sectorByMarketCap[cap]) sectorByMarketCap[cap] = {};
        sectorByMarketCap[cap][sectorName] = (sectorByMarketCap[cap][sectorName] || 0) + unmappedSector;
      }
    } else {
      const sectorName = asset.manualSector || prices[asset.symbol]?.sector || 'Other / Uncategorized';
      const isDirect = type === 'EQUITY' || type === 'STOCK';
      addToSector(sectorName, equityValue, isDirect, asset.name, asset.symbol);
      if (!sectorByMarketCap[cap]) sectorByMarketCap[cap] = {};
      sectorByMarketCap[cap][sectorName] = (sectorByMarketCap[cap][sectorName] || 0) + equityValue;
    }
  });

  const sectorData = Object.entries(sectorAllocation)
    .filter(([_, data]) => data.total > 0)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, data]) => ({ 
      name, 
      value: data.total,
      direct: data.direct,
      indirect: data.indirect,
      constituents: data.constituents
    }));

  const fundAllocation: Record<string, { total: number, constituents: { name: string, symbol: string, value: number, subHoldings?: {name: string, value: number}[] }[] }> = {};

  assets.forEach(asset => {
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
    
    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
    const totalValue = currentPrice * asset.quantity;

    if (asset.type === 'MUTUALFUND' || asset.type === 'ETF') {
      if (!fundAllocation[asset.name]) {
        fundAllocation[asset.name] = { total: 0, constituents: [] };
      }
      fundAllocation[asset.name].total += totalValue;
      
      const fundData = fundHoldings[asset.symbol];
      console.log(`DEBUG: fundData for ${asset.symbol}:`, fundData);
      
      // Determine if holdingPercent is a fraction (0-1) or percentage (0-100)
      const totalHoldingPercent = fundData?.holdings?.reduce((sum: number, h: any) => sum + (h.holdingPercent || 0), 0) || 0;
      const isPercentageScale = totalHoldingPercent > 1.5; // Heuristic: if sum > 1.5, it's likely 0-100 scale

      const subHoldings = fundData?.holdings?.map((h: any) => {
        const percent = h.holdingPercent || 0;
        const normalizedPercent = isPercentageScale ? percent : percent * 100;
        const val = totalValue * normalizedPercent / 100;
        console.log(`DEBUG: Holding ${h.holdingName || h.symbol}: percent=${percent}, normalizedPercent=${normalizedPercent}, totalValue=${totalValue}, val=${val}`);
        return {
          name: h.holdingName || h.symbol,
          value: val
        };
      }) || [];
      console.log(`DEBUG: subHoldings for ${asset.symbol}:`, subHoldings);

      fundAllocation[asset.name].constituents.push({ 
        name: asset.name, 
        symbol: asset.symbol, 
        value: totalValue,
        subHoldings
      });
    }
  });

  const fundData = Object.entries(fundAllocation)
    .filter(([_, data]) => data.total > 0)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, data]) => ({ 
      name, 
      value: data.total,
      constituents: data.constituents.map(c => ({
        name: c.name,
        symbol: c.symbol,
        value: c.value,
        subHoldings: c.subHoldings
      }))
    }));

  const treemapData = [
    {
      name: 'Portfolio',
      children: Object.entries(sectorByMarketCap).map(([cap, sectors]) => ({
        name: cap,
        children: Object.entries(sectors).map(([sector, value]) => ({
          name: sector,
          value: value
        })).filter(s => s.value > 0)
      })).filter(c => c.children && c.children.length > 0)
    }
  ];

  const stackedBarData = Object.entries(sectorByMarketCap).map(([cap, sectors]) => {
    const data: any = { name: cap };
    Object.entries(sectors).forEach(([sector, value]) => {
      data[sector] = value;
    });
    return data;
  }).filter(d => Object.keys(d).length > 1);

  const allSectors = Array.from(new Set(Object.values(sectorByMarketCap).flatMap(s => Object.keys(s))));
  console.log("DEBUG sectorByMarketCap:", JSON.stringify(sectorByMarketCap));
  console.log("DEBUG treemapData:", JSON.stringify(treemapData));
  console.log("DEBUG stackedBarData:", JSON.stringify(stackedBarData));
    
  // Check for discrepancies to ensure charts sum to exact Total Portfolio Value
  const totalAllocationValue = allocationData.reduce((sum, item) => sum + item.value, 0);
  const allocationDiscrepancy = portfolioStats.currentValue - totalAllocationValue;
  if (Math.abs(allocationDiscrepancy) > 1) {
    allocationData.push({ name: 'Uncategorized / Discrepancy', value: Math.max(0, allocationDiscrepancy) });
  }

  const topUnderlying = Object.values(underlyingExposure)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const CustomXAxisTick = (props: any) => {
    const { x, y, payload } = props;
    if (!payload || !payload.value) return null;
    const capData = stackedBarData.find(d => d.name === payload.value);
    const capTotal = capData ? Object.entries(capData).reduce((sum, [key, val]) => key !== 'name' ? sum + (val as number) : sum, 0) : 0;
    const percent = totalAllocationValue > 0 ? ((capTotal / totalAllocationValue) * 100).toFixed(1) : '0.0';
    
    const formatCompact = (val: number) => {
      if (val === undefined || val === null) return '₹0';
      if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
      if (val >= 100000) return `₹${(val / 100000).toFixed(2)}L`;
      if (val >= 1000) return `₹${(val / 1000).toFixed(1)}k`;
      return `₹${val.toFixed(0)}`;
    };

    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={16} textAnchor="middle" fill="#6b7280" fontSize={12} fontWeight={600}>
          {payload.value}
        </text>
        <text x={0} y={0} dy={32} textAnchor="middle" fill="#9ca3af" fontSize={11} fontWeight={500}>
          {formatCompact(capTotal)} ({percent}%)
        </text>
      </g>
    );
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
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-zinc-900 p-8 rounded-3xl shadow-xl max-w-md w-full text-center border border-zinc-200 dark:border-zinc-800">
          <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <PieChartIcon className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">Asset Allocation Tracker</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mb-6">Sign in to manage your assets, analyze your allocation, and get AI-powered insights.</p>
          
          <form onSubmit={isResetMode ? handleResetPassword : handleEmailAuth} className="space-y-4 mb-6">
            <div className="space-y-1 text-left">
              <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 ml-1">Email</label>
              <input 
                type="email" 
                value={emailAuthInput}
                onChange={(e) => setEmailAuthInput(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-zinc-900 dark:text-zinc-100"
              />
            </div>
            
            {!isResetMode && (
              <div className="space-y-1 text-left">
                <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300 ml-1">Password</label>
                <input 
                  type="password" 
                  value={passwordAuthInput}
                  onChange={(e) => setPasswordAuthInput(e.target.value)}
                  placeholder="••••••••"
                  required={!isResetMode}
                  minLength={6}
                  className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl px-4 py-3 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-zinc-900 dark:text-zinc-100"
                />
              </div>
            )}

            {authError && (
              <div className={`text-sm px-4 py-3 rounded-lg text-left ${authError.includes('sent') ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30' : 'bg-red-50 text-red-600 dark:bg-red-900/30'}`}>
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isSigningIn}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-xl px-4 py-3 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {isSigningIn ? 'Processing...' : (isResetMode ? 'Send Reset Link' : (isEmailLoginMode ? 'Sign In with Email' : 'Create Account'))}
            </button>
          </form>

          {isEmailLoginMode && !isResetMode && (
            <div className="text-right mb-6 -mt-4">
              <button 
                type="button"
                onClick={() => { setIsResetMode(true); setAuthError(''); }}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                Forgot password?
              </button>
            </div>
          )}
          {isResetMode && (
            <div className="text-center mb-6 -mt-4">
              <button 
                type="button"
                onClick={() => { setIsResetMode(false); setAuthError(''); }}
                className="text-sm text-zinc-500 hover:underline"
              >
                Back to login
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800"></div>
            <span className="text-zinc-400 text-sm font-medium">OR</span>
            <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-800"></div>
          </div>

          <button
            onClick={handleSignIn}
            disabled={isSigningIn}
            type="button"
            className="w-full flex items-center justify-center gap-3 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 px-6 py-3 rounded-xl font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mb-4"
          >
            {isSigningIn ? (
              <div className="w-5 h-5 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            Continue with Google
          </button>

          <p className="text-zinc-500 dark:text-zinc-400 text-sm">
            {isEmailLoginMode ? "Don't have an account? " : "Already have an account? "}
            <button 
              type="button"
              className="text-blue-600 dark:text-blue-400 font-medium hover:underline focus:outline-none"
              onClick={() => {
                setIsEmailLoginMode(!isEmailLoginMode);
                setAuthError('');
              }}
            >
              {isEmailLoginMode ? "Sign up" : "Log in"}
            </button>
          </p>
        </div>
      </div>
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
        
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">Asset Allocation Tracker</h1>
              {isFirestoreOffline && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-xs font-medium border border-amber-200 dark:border-amber-800 animate-pulse">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                  Firestore Offline
                </div>
              )}
            </div>
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
              onClick={() => fetchPrices(true)}
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
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {allocationData.map((entry, index) => {
                    const total = allocationData.reduce((sum, item) => sum + item.value, 0);
                    const percent = total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0.0';
                    return (
                      <div key={`legend-allocation-${entry.name}-${index}`} className="flex items-center justify-between text-sm">
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
                                              {c.subHoldings.sort((a: any, b: any) => b.value - a.value).map((sh: any) => (
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
                                              {c.otherAllocations.sort((a: any, b: any) => b.value - a.value).map((oa: any) => (
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
                                            {c.otherAllocations.sort((a: any, b: any) => b.value - a.value).map((oa: any) => (
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
                              {(fundHoldings[entry.constituents[0]?.symbol]?.sectorWeightings || []).sort((a: any, b: any) => b.percentage - a.percentage).map((sw: any) => (
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
                        const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
                        const entryPrice = isGroupHead ? item.entryPrice : getConvertedPrice(item.entryPrice, assetCurrency);
                        
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
                                  </div>
                                  <div className="text-[10px] text-zinc-500 mt-0.5">
                                    {item.symbol} &bull; {displaySector}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right font-medium text-zinc-700 dark:text-zinc-300">
                              {item.quantity.toLocaleString('en-IN', { maximumFractionDigits: 6 })}
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
                                <div className="flex justify-center gap-1 opacity-70 lg:opacity-0 group-hover/row:opacity-100 transition-opacity">
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
                            const isExpanded = expandedCategories[currentCategory];
                            if (isExpanded) {
                              return (
                                <tr 
                                  className="bg-zinc-100/50 dark:bg-zinc-800/30 border-t border-zinc-200 dark:border-zinc-800 cursor-pointer"
                                  onClick={() => setExpandedCategories(prev => ({ ...prev, [currentCategory]: !prev[currentCategory] }))}
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
                                  onClick={() => setExpandedCategories(prev => ({ ...prev, [currentCategory]: true }))}
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

                          {expandedCategories[currentCategory] && (() => {
                            const isSmall = isSmallCrypto(asset);
                            const prevIsSmall = index > 0 && isSmallCrypto(renderAssets[index - 1]);
                            const isSmallCryptoExpanded = expandedCategories['SmallCrypto'];
                            const renderRow = !isSmall || isSmallCryptoExpanded;
                            
                            return (
                              <Fragment>
                                {isSmall && !prevIsSmall && (
                                  isSmallCryptoExpanded ? (
                                    <tr 
                                      className="bg-zinc-100/30 dark:bg-zinc-800/10 border-t border-zinc-200/50 dark:border-zinc-800/50 cursor-pointer"
                                      onClick={() => setExpandedCategories(prev => ({ ...prev, 'SmallCrypto': !prev['SmallCrypto'] }))}
                                    >
                                      <td colSpan={8} className="px-6 py-2 pl-10 text-[10px] font-bold uppercase tracking-widest text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                                        <ChevronDown className="w-3 h-3" /> Others (Crypto &lt; ₹10)
                                      </td>
                                    </tr>
                                  ) : (
                                    <tr 
                                      className="bg-zinc-50/30 dark:bg-zinc-900/30 border-t border-zinc-200/50 dark:border-zinc-800/50 cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 transition-colors"
                                      onClick={() => setExpandedCategories(prev => ({ ...prev, 'SmallCrypto': true }))}
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
                        onClick={() => setExpandedCategories(prev => ({ ...prev, 'Total Portfolio': !prev['Total Portfolio'] }))}
                      >
                        <td className="px-6 py-4 text-zinc-900 dark:text-zinc-100 uppercase tracking-wider text-xs flex items-center gap-2">
                          {expandedCategories['Total Portfolio'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
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
                      {expandedCategories['Total Portfolio'] && (
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
                                    
                                    const currentPrice = getConvertedPrice(currentPriceRaw, currentCurrency);
                                    const assetCurrency = asset.currency || guessCurrency(asset.symbol);
                                    const entryPriceConverted = getConvertedPrice(asset.entryPrice, assetCurrency);
                                    
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
                    className="w-full pl-9 pr-10 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                    placeholder="e.g. Reliance, TCS, BTC-USD, Gold"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      if (selectedResult) setSelectedResult(null);
                    }}
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                        if (selectedResult) setSelectedResult(null);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-1 rounded-full transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                
                {isSearching && <div className="text-sm text-zinc-500 mt-2 px-1">Searching...</div>}
                
                {searchResults.length > 0 && !selectedResult && (
                  <ul className="mt-2 border border-zinc-200 dark:border-zinc-700 rounded-xl max-h-80 overflow-y-auto bg-white dark:bg-zinc-950 shadow-sm divide-y divide-zinc-100 dark:divide-zinc-800">
                    {searchResults.map((res, idx) => (
                      <li 
                        key={`${res.symbol}-${res.source || 'y'}-${idx}`} 
                        className="px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer flex justify-between items-start transition-colors gap-3"
                        onClick={() => {
                          setSelectedResult(res);
                          setSearchQuery(res.shortname || res.longname || res.symbol);
                          setSearchResults([]);
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-zinc-900 dark:text-zinc-100 leading-snug" title={res.longname || res.shortname}>
                            {res.shortname || res.longname}
                          </div>
                          <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                            <span className="font-semibold text-zinc-400 uppercase">{res.quoteType || res.typeDisp}</span>
                            <span>&bull;</span>
                            <span>{res.exchDisp || res.source}</span>
                          </div>
                        </div>
                        <div className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 whitespace-nowrap self-start">
                          {res.symbol}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedResult && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl">
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-blue-900 dark:text-blue-100 leading-tight">
                        {selectedResult.shortname || selectedResult.longname}
                      </div>
                      <div className="text-[10px] text-blue-700 dark:text-blue-300 mt-1 font-mono uppercase tracking-wider">
                        {selectedResult.symbol} &bull; {selectedResult.quoteType || selectedResult.typeDisp}
                      </div>
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
                  
                  {findExistingAssetToMerge(selectedResult) && !editingAssetId && (
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
                                    {(findExistingAssetToMerge(selectedResult)?.quantity || 0) + parseFloat(quantity)}
                                  </div>
                                </div>
                                <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded border border-amber-100 dark:border-amber-900/30">
                                  <div className="text-[10px] text-zinc-500">New Avg Price</div>
                                  <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                    {(() => {
                                      const existing = findExistingAssetToMerge(selectedResult);
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
                                const existing = findExistingAssetToMerge(selectedResult);
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

              {selectedResult && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Manual Price (LTP Override)</label>
                  <div className="relative">
                    <input 
                      type="number" 
                      step="any"
                      min="0"
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      value={manualPrice}
                      onChange={(e) => setManualPrice(e.target.value)}
                      placeholder="Leave empty to use market price"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">
                      {entryCurrency}
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">Use this if the market price (LTP) is not available or incorrect.</p>
                </div>
              )}

              {selectedResult && (
                <div>
                  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Sector (Manual Override)</label>
                  <div className="relative">
                    <input 
                      type="text" 
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      value={manualSector}
                      onChange={(e) => setManualSector(e.target.value)}
                      placeholder="e.g. Financial Services, Technology..."
                      list="sector-suggestions"
                    />
                    <datalist id="sector-suggestions">
                      <option value="Financial Services" />
                      <option value="Technology" />
                      <option value="Healthcare" />
                      <option value="Consumer Cyclical" />
                      <option value="Consumer Defensive" />
                      <option value="Energy" />
                      <option value="Industrials" />
                      <option value="Real Estate" />
                      <option value="Communication Services" />
                      <option value="Basic Materials" />
                      <option value="Utilities" />
                      <option value="Fixed Income / Debt" />
                      <option value="Cash / Liquid" />
                    </datalist>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-1">Manually categorize this asset for sector allocation charts.</p>
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
                    const val = e.target.value as 'indianapi' | 'yahoo' | 'newapi' | 'tickertape';
                    setSearchSource(val);
                    syncToDb({ settings: { searchSource: val } });
                  }}
                  className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                >
                  <option value="tickertape">Tickertape (Recommended)</option>
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
                    const val = e.target.value as 'openrouter' | 'google' | 'huggingface';
                    setAiProvider(val);
                    syncToDb({ settings: { aiProvider: val } });
                  }}
                  className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="google">Google Gemini (Built-in)</option>
                  <option value="huggingface">Hugging Face (Gemma 4/2)</option>
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

              {aiProvider === 'huggingface' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Hugging Face API Token</label>
                    <input 
                      type="password" 
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      placeholder="hf_..."
                      defaultValue={huggingFaceKey}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveHuggingFaceKey(e.currentTarget.value);
                      }}
                      onBlur={(e) => saveHuggingFaceKey(e.target.value)}
                    />
                    <p className="text-xs text-zinc-500 mt-2">
                      Required for HF Inference API. Get one at <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">huggingface.co</a>.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">HF Model ID</label>
                    <select
                      value={['google/gemma-2-27b-it', 'google/gemma-2-9b-it', 'google/gemma-2-2b-it', 'google/gemma-7b-it'].includes(huggingFaceModel) ? huggingFaceModel : 'custom'}
                      onChange={(e) => {
                        if (e.target.value === 'custom') {
                          setHuggingFaceModel('');
                          syncToDb({ settings: { huggingFaceModel: '' } });
                        } else {
                          setHuggingFaceModel(e.target.value);
                          syncToDb({ settings: { huggingFaceModel: e.target.value } });
                        }
                      }}
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                    >
                      <option value="google/gemma-2-27b-it">Gemma 2 27B IT</option>
                      <option value="google/gemma-2-9b-it">Gemma 2 9B IT</option>
                      <option value="google/gemma-2-2b-it">Gemma 2 2B IT</option>
                      <option value="google/gemma-7b-it">Gemma 1 7B IT (Legacy)</option>
                      <option value="custom">Custom HF Model ID...</option>
                    </select>
                    {!['google/gemma-2-27b-it', 'google/gemma-2-9b-it', 'google/gemma-2-2b-it', 'google/gemma-7b-it'].includes(huggingFaceModel) && (
                       <input
                       type="text"
                       placeholder="e.g., google/gemma-2-27b-it"
                       value={huggingFaceModel}
                       onChange={(e) => {
                         setHuggingFaceModel(e.target.value);
                         syncToDb({ settings: { huggingFaceModel: e.target.value } });
                       }}
                       className="w-full mt-2 px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                       autoFocus
                     />
                    )}
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

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">Data Management</h3>
                <div className="flex gap-3">
                  <button
                    onClick={handleExportData}
                    className="flex-1 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl font-medium transition-colors text-sm"
                  >
                    Export Backup
                  </button>
                  <label className="flex-1 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl font-medium transition-colors text-sm text-center cursor-pointer">
                    Import Backup
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportData}
                      className="hidden"
                    />
                  </label>
                </div>
                <p className="text-xs text-zinc-500 mt-2 text-center">
                  Export your portfolio data to transfer it to a different Google account.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  <button
                    onClick={handleRestoreFromMongo}
                    className="w-full px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl font-medium transition-colors text-sm text-center relative overflow-hidden"
                  >
                    Restore from MongoDB Backup
                    {restoreStatus && (
                      <div className={`absolute inset-0 flex items-center justify-center font-medium ${restoreStatus.isError ? 'bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'}`}>
                        {restoreStatus.message}
                      </div>
                    )}
                  </button>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button
                  onClick={() => {
                    fetchPrices(true);
                    setIsSettingsOpen(false);
                  }}
                  disabled={isLoadingPrices || assets.length === 0}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingPrices ? 'animate-spin' : ''}`} />
                  <span>Full Refresh (Sync with Tickertape)</span>
                </button>
                <p className="text-[10px] text-zinc-500 mt-2 text-center">
                  This will force a re-fetch of all asset data from Tickertape and other sources, bypassing cached data.
                </p>
              </div>
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
                <div>
                  <h3 className="font-semibold leading-none">AI Assistant</h3>
                  <p className="text-[10px] text-blue-100 mt-1 opacity-80">
                    {aiProvider === 'google' ? googleModel : selectedModel}
                  </p>
                </div>
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
                <div key={`chat-msg-${idx}`} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                    msg.role === 'user' 
                      ? 'bg-blue-600 text-white rounded-br-sm' 
                      : 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700 rounded-bl-sm shadow-sm'
                  }`}>
                    {msg.content}
                  </div>
                  {msg.model && (
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1 px-1 flex items-center gap-1">
                      by {msg.model}
                      {msg.isFallback && (
                        <span className="text-[9px] bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-1 rounded border border-amber-200 dark:border-amber-800/50">
                          Fallback
                        </span>
                      )}
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

      {/* Manual Sector Allocation Modal */}
      {manualSectorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Edit Sectors: {manualSectorModal.name}</h2>
              <button onClick={() => setManualSectorModal(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {manualSectorModal.sectors.map((s, i) => (
                <div key={`manual-sector-${s.sector || 'new'}-${i}`} className="flex gap-2">
                  <select
                    value={s.sector}
                    onChange={(e) => {
                      const newSectors = [...manualSectorModal.sectors];
                      newSectors[i].sector = e.target.value;
                      setManualSectorModal({ ...manualSectorModal, sectors: newSectors });
                    }}
                    className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none"
                  >
                    <option value="">Select Sector</option>
                    {['Technology', 'Financial Services', 'Healthcare', 'Consumer Cyclical', 'Consumer Defensive', 'Energy', 'Industrials', 'Real Estate', 'Communication Services', 'Basic Materials', 'Utilities', 'Other'].map((sector, sIdx) => (
                      <option key={`sector-opt-${sector}-${sIdx}`} value={sector}>{sector}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={s.percentage}
                    onChange={(e) => {
                      const newSectors = [...manualSectorModal.sectors];
                      newSectors[i].percentage = Number(e.target.value);
                      setManualSectorModal({ ...manualSectorModal, sectors: newSectors });
                    }}
                    placeholder="%"
                    className="w-20 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none"
                  />
                  <button onClick={() => {
                    const newSectors = manualSectorModal.sectors.filter((_, idx) => idx !== i);
                    setManualSectorModal({ ...manualSectorModal, sectors: newSectors });
                  }} className="text-red-500 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button onClick={() => {
                setManualSectorModal({ ...manualSectorModal, sectors: [...manualSectorModal.sectors, { sector: '', percentage: 0 }] });
              }} className="w-full py-2 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                + Add Sector
              </button>
            </div>
            <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
              <button onClick={() => setManualSectorModal(null)} className="px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">Cancel</button>
              <button onClick={() => {
                const newFundHoldings = { 
                  ...fundHoldings, 
                  [manualSectorModal.symbol]: { 
                    ...fundHoldings[manualSectorModal.symbol],
                    sectorWeightings: manualSectorModal.sectors,
                    debug: null
                  } 
                };
                syncToDb({ fundHoldings: newFundHoldings });
                setManualSectorModal(null);
              }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Fund Holding Entry Modal */}
      {manualFundModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Edit Holdings: {manualFundModal.name}</h2>
              <button onClick={() => setManualFundModal(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {manualFundModal.holdings.map((h, i) => (
                <div key={`manual-holding-${h.name || 'new'}-${i}`} className="flex gap-2">
                  <input
                    type="text"
                    value={h.name}
                    onChange={(e) => {
                      const newHoldings = [...manualFundModal.holdings];
                      newHoldings[i].name = e.target.value;
                      setManualFundModal({ ...manualFundModal, holdings: newHoldings });
                    }}
                    placeholder="Holding Name"
                    className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none"
                  />
                  <input
                    type="number"
                    value={h.holdingPercent}
                    onChange={(e) => {
                      const newHoldings = [...manualFundModal.holdings];
                      newHoldings[i].holdingPercent = Number(e.target.value);
                      setManualFundModal({ ...manualFundModal, holdings: newHoldings });
                    }}
                    placeholder="%"
                    className="w-20 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none"
                  />
                  <button onClick={() => {
                    const newHoldings = manualFundModal.holdings.filter((_, idx) => idx !== i);
                    setManualFundModal({ ...manualFundModal, holdings: newHoldings });
                  }} className="text-red-500 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button onClick={() => {
                setManualFundModal({ ...manualFundModal, holdings: [...manualFundModal.holdings, { name: '', holdingPercent: 0 }] });
              }} className="w-full py-2 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                + Add Holding
              </button>
            </div>
            <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
              <button onClick={() => setManualFundModal(null)} className="px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">Cancel</button>
              <button onClick={() => {
                const newFundHoldings = { 
                  ...fundHoldings, 
                  [manualFundModal.symbol]: { 
                    ...fundHoldings[manualFundModal.symbol],
                    holdings: manualFundModal.holdings,
                    debug: null
                  } 
                };
                syncToDb({ fundHoldings: newFundHoldings });
                setManualFundModal(null);
              }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Save</button>
            </div>
          </div>
        </div>
      )}

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
