'use client';

import { useState, useEffect, useCallback, useRef, Fragment, useMemo } from 'react';
import { Plus, Search, Trash2, RefreshCw, TrendingUp, TrendingDown, PieChart as PieChartIcon, BarChart3, List, Settings, Target, X, Send, Bot, ArrowUp, ArrowDown, ArrowUpDown, MessageSquarePlus, ChevronUp, ChevronDown, ChevronRight, Pencil, Info, LogOut, Filter, Briefcase, Layers, Activity, LayoutDashboard, Menu, Wallet } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend, Treemap, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { auth, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, logOut } from '@/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
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
import { guessCurrency, getConvertedPrice, normalizeCategory, getCommoditySubCategory, getCapCategory, normalizeGroup, formatCompact, getBaseCryptoSymbol, isSameCrypto, normalizeExchangeAsset } from '@/lib/portfolio-utils';
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
          className="font-bold text-[12px] uppercase tracking-wider opacity-40"
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

const formatQuoteAge = (asOf: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - asOf) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
};

const PriceStatusIndicator = ({ asOf, stale, isFetching }: { asOf?: number | null, stale?: boolean, isFetching: boolean }) => {
  if (isFetching) return (
    <div className="flex items-center gap-1 text-[10px] text-blue-500 font-medium">
      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
      <span>Updating...</span>
    </div>
  );
  if (!asOf) return (
    <div
      className={`flex items-center gap-1 text-[10px] font-medium ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`}
      title={stale ? 'Showing a cached value; no live quote timestamp is available.' : undefined}
    >
      <div className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-amber-500' : 'bg-zinc-300'}`} />
      <span>{stale ? 'Cached' : 'New'}</span>
    </div>
  );

  const isFresh = !stale && Date.now() - asOf < 5 * 60 * 1000;
  return (
    <div
      className={`flex items-center gap-1 text-[10px] font-medium ${isFresh ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}
      title={new Date(asOf).toLocaleString()}
    >
      <div className={`w-1.5 h-1.5 rounded-full ${isFresh ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      <span>{stale ? 'Cached' : isFresh ? 'Live' : `Old · ${formatQuoteAge(asOf)}`}</span>
    </div>
  );
};

/** Build price rows from an exchange response or a cached exchange snapshot. */
const exchangePrices = (
  assets: Asset[],
  lastUpdated: number,
  source: string,
): Record<string, PriceData> => {
  const quotes: Record<string, PriceData> = {};
  assets.forEach((asset) => {
    const price = Number(asset.currentPrice);
    if (!Number.isFinite(price) || price <= 0) return;
    quotes[asset.symbol] = {
      symbol: asset.symbol,
      regularMarketPrice: price,
      currency: asset.currency || 'USD',
      shortName: asset.name,
      quoteType: asset.type === 'CASH' ? 'CASH' : 'CRYPTO',
      source,
      lastUpdated,
      asOf: lastUpdated,
      stale: source.toLowerCase().includes('cached'),
    };
  });
  return quotes;
};

const RecursiveAllocationRow = ({ node, depth = 0, expandedCategories, setExpandedCategories }: any) => {
  const isExpanded = expandedCategories[node.fullPath];
  const hasChildren = node.subCategories && node.subCategories.length > 0;
  const hasConstituents = node.constituents && node.constituents.length > 0;
  const isClickable = hasChildren || hasConstituents;

  const toggleExpand = () => {
    if (isClickable) {
      setExpandedCategories((prev: any) => ({ ...prev, [node.fullPath]: !prev[node.fullPath] }));
    }
  };

  const plClass = depth === 0 ? 'px-6' : depth === 1 ? 'pl-12 pr-6' : depth === 2 ? 'pl-18 pr-6' : 'pl-24 pr-6';
  const plBorderClass = depth === 0 ? 'pl-6' : depth === 1 ? 'pl-16' : depth === 2 ? 'pl-22' : 'pl-28';

  return (
    <Fragment>
      <tr 
        className={`${depth === 0 ? 'hover:bg-zinc-50 dark:hover:bg-zinc-900/50' : 'bg-zinc-50/30 dark:bg-zinc-900/10 hover:bg-zinc-50 dark:hover:bg-zinc-900/50'} transition-colors ${isClickable ? 'cursor-pointer' : ''}`}
        onClick={toggleExpand}
      >
        <td className={`${plClass} py-4 font-medium flex items-center gap-2 ${depth > 0 ? 'text-zinc-600 dark:text-zinc-400' : ''}`}>
          {isClickable && (
            isExpanded ? <ChevronDown className="w-4 h-4 text-zinc-400" /> : <ChevronRight className="w-4 h-4 text-zinc-400" />
          )}
          {node.category}
          {node.category === 'Cash' && depth === 0 && (
            <div className="group relative flex items-center">
              <Info className="w-4 h-4 text-zinc-400 cursor-help" />
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block w-64 p-3 bg-zinc-800 text-xs text-zinc-100 rounded-lg shadow-xl z-10 text-center leading-relaxed">
                Includes your direct cash holdings plus the cash portion of your mutual funds. Mutual funds hold cash for liquidity, handling redemptions, or waiting for investment opportunities.
                <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-800"></div>
              </div>
            </div>
          )}
        </td>
        <td className={`px-5 py-3.5 text-right ${depth > 0 ? 'text-zinc-600 dark:text-zinc-400' : ''}`}>₹{node.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
        <td className={`px-5 py-3.5 text-right ${depth > 0 ? 'text-zinc-600 dark:text-zinc-400' : ''}`}>{node.currentPercentage.toFixed(1)}%</td>
        <td className={`px-5 py-3.5 text-right ${depth > 0 ? 'text-zinc-600 dark:text-zinc-400' : ''}`}>{node.idealPercentage.toFixed(1)}%</td>
        <td className={`px-5 py-3.5 text-right font-medium ${node.diffPercentage > 1 ? 'text-red-500' : node.diffPercentage < -1 ? 'text-blue-500' : 'text-emerald-500'}`}>
          {node.diffPercentage > 0 ? '+' : ''}{node.diffPercentage.toFixed(1)}%
        </td>
        <td className="px-5 py-3.5 text-right">
          {node.diffPercentage > 2 ? (
            <span className="text-red-500 font-medium">Reduce by ₹{Math.abs(node.diffValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          ) : node.diffPercentage < -2 ? (
            <span className="text-blue-500 font-medium">Invest ₹{Math.abs(node.diffValue).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          ) : (
            <span className="text-emerald-500 font-medium">On Track</span>
          )}
        </td>
      </tr>

      {isExpanded && hasChildren && node.subCategories.map((subNode: any, idx: number) => (
        <RecursiveAllocationRow 
          key={`${subNode.fullPath}-${idx}`} 
          node={subNode} 
          depth={depth + 1} 
          expandedCategories={expandedCategories} 
          setExpandedCategories={setExpandedCategories} 
        />
      ))}

      {isExpanded && !hasChildren && hasConstituents && (
        <tr className="bg-zinc-50/50 dark:bg-zinc-900/20">
          <td colSpan={6} className="px-5 py-3.5">
            <div className={`${plBorderClass} border-l-2 border-zinc-200 dark:border-zinc-700 space-y-2`}>
              {node.constituents.map((constituent: any, cIdx: number) => (
                <div key={`${constituent.symbol || constituent.name}-${cIdx}`} className="flex justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-400">{constituent.name} <span className="text-xs opacity-50">({constituent.symbol})</span></span>
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    ₹{constituent.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    <span className="text-xs text-zinc-500 ml-2 inline-block w-12 text-right">
                      {((constituent.value / node.currentValue) * 100).toFixed(1)}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
};

const RecursiveLegendItem = ({ node, index, depth = 0, expandedCategories, setExpandedCategories, topLevelColor, totalValue }: any) => {
  const isExpanded = expandedCategories[node.fullPath];
  const percent = totalValue > 0 ? ((node.currentValue / totalValue) * 100).toFixed(1) : '0.0';
  const hasSub = node.subCategories && node.subCategories.length > 0;
  
  return (
    <div className={`flex flex-col ${depth === 0 ? 'gap-1.5 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800' : 'mt-1.5'}`}>
      <div 
        className={`flex items-center justify-between text-sm ${hasSub || (node.constituents && node.constituents.length > 0) ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''} ${depth > 0 ? 'pt-1.5 border-t border-zinc-200/50 dark:border-zinc-700/50' : ''}`}
        onClick={() => {
          if (hasSub || (node.constituents && node.constituents.length > 0)) {
            setExpandedCategories((prev: any) => ({ ...prev, [node.fullPath]: !prev[node.fullPath] }));
          }
        }}
      >
        <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 12}px` }}>
          {depth === 0 ? (
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: topLevelColor }} />
          ) : (
            <div className="w-3 flex justify-center shrink-0">
               {hasSub || (node.constituents && node.constituents.length > 0) ? (isExpanded ? <ChevronDown className="w-3 h-3 text-zinc-400" /> : <ChevronRight className="w-3 h-3 text-zinc-400" />) : <div className="w-1.5 h-1.5 rounded-full bg-zinc-300 dark:bg-zinc-600" />}
            </div>
          )}
          <span className={`${depth === 0 ? 'font-semibold' : 'font-medium'} text-zinc-900 dark:text-zinc-100`}>
            {node.category}
          </span>
        </div>
        <div className="font-bold text-zinc-900 dark:text-zinc-100 whitespace-nowrap pl-2">
          ₹{node.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          <span className="text-zinc-400 ml-1.5 font-normal text-xs">
            ({percent}%)
          </span>
        </div>
      </div>

      {depth === 0 && (
        <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden flex mt-1">
          <div 
            className="h-full transition-all duration-500 rounded-full" 
            style={{ width: `${percent}%`, backgroundColor: topLevelColor }} 
          />
        </div>
      )}
      
      {isExpanded && (
        <div className="flex flex-col gap-1 mt-1">
          {hasSub && [...node.subCategories].sort((a: any, b: any) => b.currentValue - a.currentValue).map((subNode: any, i: number) => (
            <RecursiveLegendItem 
              key={`legend-${subNode.fullPath}-${i}`}
              node={subNode}
              index={i}
              depth={depth + 1}
              expandedCategories={expandedCategories}
              setExpandedCategories={setExpandedCategories}
              topLevelColor={topLevelColor}
              totalValue={totalValue}
            />
          ))}
          {(!hasSub && node.constituents && node.constituents.length > 0) && (
             <div className="mt-1 pt-1 border-t border-zinc-200/50 dark:border-zinc-700/50 flex flex-col gap-1.5">
               {[...node.constituents].sort((a: any, b: any) => b.value - a.value).map((c: any, i: number) => {
                 const cPercent = totalValue > 0 ? ((c.value / totalValue) * 100).toFixed(1) : '0.0';
                 return (
                   <div key={`const-${i}`} className="flex justify-between items-center text-xs text-zinc-600 dark:text-zinc-400" style={{ paddingLeft: `${(depth + 1) * 12 + 20}px` }}>
                     <span className="truncate pr-2">{c.name}</span>
                     <div className="flex items-center gap-2 shrink-0">
                       <span>₹{c.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                       <span className="w-10 text-right opacity-70">{cPercent}%</span>
                     </div>
                   </div>
                 );
               })}
             </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function Dashboard() {
  const [binanceAssets, setBinanceAssets] = useState<Asset[]>([]);
  const [coindcxAssets, setCoindcxAssets] = useState<Asset[]>([]);
  const [binanceStatus, setBinanceStatus] = useState<{ state: 'connecting' | 'connected' | 'error' | 'cached', lastSynced?: number, error?: string }>({ state: 'connecting' });
  const [coindcxStatus, setCoindcxStatus] = useState<{ state: 'connecting' | 'connected' | 'error' | 'cached', lastSynced?: number, error?: string }>({ state: 'connecting' });
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'portfolio' | 'screener'>('portfolio');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAllocationSettingsOpen, setIsAllocationSettingsOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({ 'Total Portfolio': true });
  const [exposureTab, setExposureTab] = useState<'All' | 'Category' | 'Sector' | 'MarketCap'>('All');
  const [expandedExposureGroup, setExpandedExposureGroup] = useState<string | null>(null);
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
    cachedCrypto, setCachedCrypto,
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

  const pricingAssets = useMemo(() => {
    const list = [...assets];
    if (binanceStatus.state === 'cached') {
      list.push(...binanceAssets);
    }
    if (coindcxStatus.state === 'cached') {
      list.push(...coindcxAssets);
    }
    return list;
  }, [assets, binanceStatus.state, binanceAssets, coindcxStatus.state, coindcxAssets]);

  const { prices, setPrices, isLoadingPrices, priceProgress, fetchPrices } = usePrices(pricingAssets, fundHoldings);

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
    const fetchExchange = async (url: string, setter: (assets: Asset[]) => void, exchangeName: string, setStatus: any) => {
      setStatus({ state: 'connecting' });
      try {
        const res = await fetch(url);
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.warn(`${exchangeName}: API returned invalid JSON (HTML error page)`);
          setStatus({ state: 'error', error: 'API returned invalid JSON' });
          return;
        }

        if (data && data.error) {
          console.warn(`${exchangeName}: ${data.error}`);
          setStatus({ state: 'error', error: data.error });
          return;
        }

        if (!Array.isArray(data)) {
          console.warn(`${exchangeName}: Unknown response format`);
          setStatus({ state: 'error', error: 'Unknown response format' });
          return;
        }

        const mapped = data.map((a: any) => normalizeExchangeAsset(a, exchangeName));
        setter(mapped);
        setStatus({ state: 'connected', lastSynced: Date.now() });
        
        // Background sync to Firebase
        syncToDb({ [`cachedCrypto.${exchangeName.toLowerCase()}`]: { lastSynced: Date.now(), assets: mapped } });

        setPrices(prev => ({
          ...prev,
          ...exchangePrices(mapped, Date.now(), `${exchangeName} API`),
        }));
      } catch (err: any) {
        console.warn(`${exchangeName} fetch failed:`, err.message);
        setStatus({ state: 'error', error: err.message });
      }
    };

    fetchExchange('/api/crypto/binance', setBinanceAssets, 'Binance', setBinanceStatus);
    fetchExchange('/api/crypto/coindcx', setCoindcxAssets, 'CoinDCX', setCoindcxStatus);
  }, [user, isAuthReady]);
  useEffect(() => {
    if (!cachedCrypto) return;

    const restore = (
      cached: { lastSynced?: number; assets?: Asset[] } | undefined,
      exchangeName: 'Binance' | 'CoinDCX',
      setter: (assets: Asset[]) => void,
      setStatus: (status: { state: 'cached'; lastSynced?: number }) => void,
    ) => {
      if (!cached || !Array.isArray(cached.assets) || cached.assets.length === 0) return;

      const restored = cached.assets.map((asset) =>
        normalizeExchangeAsset({ ...asset, source: 'Cached' } as any, exchangeName),
      );
      // No stored timestamp means genuinely old cached data; leave `asOf`
      // empty so the UI shows "Cached" instead of pretending it is current.
      const lastSynced = Number(cached.lastSynced) || 0;

      setter(restored);
      setPrices(prev => ({
        ...prev,
        ...exchangePrices(restored, lastSynced, `${exchangeName} (cached)`),
      }));
      setStatus({ state: 'cached', lastSynced: lastSynced || undefined });
    };

    if (binanceStatus.state === 'error') {
      restore(cachedCrypto.binance, 'Binance', setBinanceAssets, setBinanceStatus);
    }
    if (coindcxStatus.state === 'error') {
      restore(cachedCrypto.coindcx, 'CoinDCX', setCoindcxAssets, setCoindcxStatus);
    }
  }, [binanceStatus.state, coindcxStatus.state, cachedCrypto, setPrices]);


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
        if (cat === 'Equities') return 1;
        if (cat === 'Mutual Funds') return 2;
        if (cat === 'ETFs') return 3;
        if (cat === 'Fixed Income') return 4;
        if (cat === 'Commodities') return 5;
        if (cat === 'Crypto') return 6;
        if (cat === 'Cash') return 7;
        return 8; 
      };

      const priorityA = getCategoryPriority(a);
      const priorityB = getCategoryPriority(b);

      if (priorityA !== priorityB) return priorityA - priorityB;

      if (priorityA === 6) {
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

  const navItemClass = (isActive: boolean) =>
    `flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50'
        : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
    }`;

  const navContent = (
    <>
      <div>
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Workspace</p>
        <div className="space-y-1">
          <button onClick={() => { setActiveTab('portfolio'); setIsSidebarOpen(false); }} className={navItemClass(activeTab === 'portfolio')}>
            <LayoutDashboard className="h-4 w-4 shrink-0" />
            Dashboard
          </button>
          <button onClick={() => { setActiveTab('screener'); setIsSidebarOpen(false); }} className={navItemClass(activeTab === 'screener')}>
            <Filter className="h-4 w-4 shrink-0" />
            Screener
          </button>
        </div>
      </div>
      <div>
        <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">Preferences</p>
        <div className="space-y-1">
          <button onClick={() => { setIsAllocationSettingsOpen(true); setIsSidebarOpen(false); }} className={navItemClass(false)}>
            <Target className="h-4 w-4 shrink-0" />
            Ideal allocation
          </button>
          <button onClick={() => { setIsSettingsOpen(true); setIsSidebarOpen(false); }} className={navItemClass(false)}>
            <Settings className="h-4 w-4 shrink-0" />
            Settings
          </button>
        </div>
      </div>
    </>
  );

  const brand = (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900">
        <TrendingUp className="h-4 w-4" />
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold tracking-tight">Asset Tracker</div>
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Portfolio intelligence</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {runningOperations.length > 0 && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-blue-600 text-white text-center py-2 text-sm font-semibold shadow-md animate-in slide-in-from-top-2">
          {runningOperations.join(' | ')}...
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:w-64 lg:flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-16 items-center border-b border-zinc-200 px-5 dark:border-zinc-800">
          {brand}
        </div>
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {navContent}
        </nav>
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              {(user?.displayName || user?.email || 'U').charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{user?.displayName || 'Account'}</div>
              <div className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{user?.email}</div>
            </div>
            <button
              onClick={logOut}
              title="Sign out"
              className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-4 dark:border-zinc-800">
              {brand}
              <button onClick={() => setIsSidebarOpen(false)} className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">{navContent}</nav>
            <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
              <button onClick={logOut} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-zinc-200 bg-white/80 px-4 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/80 sm:px-6 lg:px-8">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="-ml-1 rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold tracking-tight">
              {activeTab === 'portfolio' ? 'Dashboard' : 'Screener'}
            </h1>
            <p className="hidden truncate text-[11px] text-zinc-500 dark:text-zinc-400 sm:block">
              {activeTab === 'portfolio' ? 'Overview of your entire portfolio' : 'Discover and compare instruments'}
            </p>
          </div>

          <div className="hidden items-center gap-1.5 md:flex">
            {(binanceStatus.state === 'connected' || binanceStatus.state === 'cached') && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <span className={`h-1.5 w-1.5 rounded-full ${binanceStatus.state === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                Binance
              </span>
            )}
            {(coindcxStatus.state === 'connected' || coindcxStatus.state === 'cached') && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                <span className={`h-1.5 w-1.5 rounded-full ${coindcxStatus.state === 'connected' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                CoinDCX
              </span>
            )}
          </div>

          <button
            onClick={() => { fetchPrices(true, undefined, true); forceRefreshHoldings(); }}
            disabled={isLoadingPrices || assets.length === 0}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title="Refresh all data"
          >
            <RefreshCw className={`h-4 w-4 ${isLoadingPrices ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add asset</span>
          </button>
        </header>

        <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        {activeTab === 'portfolio' ? (
          <>
            {/* KPI row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Total value</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                <Wallet className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
              ₹{portfolioStats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px]">
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold ${totalProfitLoss >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>
                {totalProfitLoss >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {totalProfitLossPercent.toFixed(2)}%
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">all time</span>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Total invested</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <TrendingUp className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
              ₹{portfolioStats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </div>
            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">Cost basis across all holdings</div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Total P&amp;L</span>
              <div className={`flex h-7 w-7 items-center justify-center rounded-md ${totalProfitLoss >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400'}`}>
                {totalProfitLoss >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              </div>
            </div>
            <div className={`mt-3 text-2xl font-semibold tracking-tight tabular-nums ${totalProfitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {totalProfitLoss >= 0 ? '+' : ''}₹{totalProfitLoss.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
            </div>
            <div className="mt-2 flex items-center gap-1.5 text-[11px]">
              <span className={`font-semibold ${totalProfitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                {totalProfitLoss >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%
              </span>
              <span className="text-zinc-500 dark:text-zinc-400">unrealised return</span>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Holdings</span>
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                <Layers className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
              {mergedAssets.length.toLocaleString('en-IN')}
            </div>
            <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
              Across {allCategories.length} allocation categories
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Allocation Chart */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col">
            <div className="mb-5 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                <PieChartIcon className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Asset Allocation</h2>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">By asset class</p>
              </div>
            </div>
            {assets.length > 0 ? (
              <div className="flex flex-col flex-1">
                <div className="min-h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={allocationAnalysis.map((node: any) => ({ name: node.category, value: node.currentValue }))}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        {allocationAnalysis.map((entry: any, index: number) => (
                          <Cell key={`cell-allocation-${entry.category}-${index}`} fill={COLORS[index % COLORS.length]} />
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
                  {allocationAnalysis.map((node: any, index: number) => (
                    <RecursiveLegendItem 
                      key={`legend-allocation-${node.fullPath}-${index}`}
                      node={node}
                      index={index}
                      depth={0}
                      expandedCategories={expandedCategories}
                      setExpandedCategories={setExpandedCategories}
                      topLevelColor={COLORS[index % COLORS.length]}
                      totalValue={portfolioStats.currentValue}
                    />
                  ))}
                </div>
                <div className="mt-6 pt-4 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                  <span className="text-sm font-bold text-zinc-500 uppercase tracking-wider">Total Allocation Value</span>
                  <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
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
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col">
            <div className="mb-5 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Market Cap Exposure</h2>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Direct vs fund exposure</p>
              </div>
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
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Direct Stocks:</div>
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
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Mutual Funds / ETFs:</div>
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
                  <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sector Allocation Chart */}
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col">
            <div className="mb-5 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                <PieChartIcon className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Sector Allocation</h2>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Across sectors</p>
              </div>
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
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Direct Stocks:</div>
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
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold mb-1.5">Mutual Funds / ETFs:</div>
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
                    <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
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
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col">
            <div className="mb-5 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 dark:bg-purple-500/10 dark:text-purple-400">
                <PieChartIcon className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Mutual Fund / ETF Allocation</h2>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">By fund type</p>
              </div>
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

                        {(() => {
                          const symbol = entry.constituents[0]?.symbol;
                          const alloc = symbol ? fundHoldings[symbol]?.assetAllocation : null;
                          
                          if (!alloc) return null;
                          
                          return (
                            <div className="flex flex-col gap-1.5">
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-zinc-500 uppercase tracking-wider font-medium">
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

                        {expandedFunds[entry.name] && entry.constituents && entry.constituents.length > 0 && (
                          <div className="mt-2 pt-3 border-t border-zinc-200 dark:border-zinc-700 space-y-4">
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Underlying Holdings:</div>
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
                              {fundHoldings[entry.constituents[0]?.symbol]?.lookthrough === 'tracked-index' && (
                                <div className="mb-2 text-[10px] text-amber-600 dark:text-amber-400 italic">
                                  {fundHoldings[entry.constituents[0]?.symbol]?.note || 'Holdings mirror the tracked index, not the ETF’s exact portfolio.'}
                                </div>
                              )}
                              {entry.constituents.flatMap(c => c.subHoldings || []).sort((a: any, b: any) => b.value - a.value).map((sh: any) => (
                                <div key={sh.symbol || sh.name} className="flex justify-between items-center text-xs text-zinc-600 dark:text-zinc-400 mb-1">
                                  <span className="truncate max-w-[180px]">{sh.name}</span>
                                  <span className="font-medium">₹{sh.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                              ))}
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">Sector Allocation:</div>
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
                    <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
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
          <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs flex flex-col">
            <div className="mb-5 flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400">
                <BarChart3 className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold tracking-tight">Sector by Market Cap</h2>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Combined view</p>
              </div>
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
        <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
          <div className="mb-5 flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
              <BarChart3 className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Sector Distribution across Market Caps</h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Stacked by cap segment</p>
            </div>
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
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden">
            <div className="flex items-center justify-between gap-4 border-b border-zinc-200 p-5 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                  <PieChartIcon className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">Asset Allocation Analysis</h2>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Current vs ideal weights</p>
                </div>
              </div>
              <button onClick={() => setIsAllocationSettingsOpen(true)} className="shrink-0 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                Edit ideal allocation
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-zinc-50/95 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider backdrop-blur dark:bg-zinc-950/90 dark:text-zinc-400">
                  <tr>
                    <th className="px-5 py-3.5 font-medium">Category</th>
                    <th className="px-5 py-3.5 font-medium text-right">Current Value</th>
                    <th className="px-5 py-3.5 font-medium text-right">Current %</th>
                    <th className="px-5 py-3.5 font-medium text-right">Ideal %</th>
                    <th className="px-5 py-3.5 font-medium text-right">Difference %</th>
                    <th className="px-5 py-3.5 font-medium text-right">Action Needed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {allocationAnalysis.map((item, index) => (
                    <RecursiveAllocationRow 
                      key={`category-${item.fullPath}-${index}`} 
                      node={item} 
                      expandedCategories={expandedCategories} 
                      setExpandedCategories={setExpandedCategories} 
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Asset List */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden">
            <div className="border-b border-zinc-200 p-5 dark:border-zinc-800">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">Your Assets</h2>
                  <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">All holdings, grouped by category</p>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <div className="flex items-center gap-1"><div className="h-1.5 w-1.5 rounded-full bg-blue-500"></div> Fetching</div>
                  <div className="flex items-center gap-1"><div className="h-1.5 w-1.5 rounded-full bg-emerald-500"></div> Fresh</div>
                  <div className="flex items-center gap-1"><div className="h-1.5 w-1.5 rounded-full bg-yellow-500"></div> Stale</div>
                  <div className="flex items-center gap-1"><div className="h-1.5 w-1.5 rounded-full bg-zinc-300"></div> Unknown</div>
                </div>
              </div>
            </div>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-zinc-50/95 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider backdrop-blur dark:bg-zinc-950/90 dark:text-zinc-400">
                  <tr>
                    <th className="px-5 py-3.5 font-medium cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('name')}>
                      <div className="flex items-center">Asset <SortIndicator column="name" /></div>
                    </th>
                    <th className="px-5 py-3.5 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('quantity')}>
                      <div className="flex items-center justify-end">Holdings <SortIndicator column="quantity" /></div>
                    </th>
                    <th className="px-5 py-3.5 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('entryPrice')}>
                      <div className="flex items-center justify-end">Avg. Price <SortIndicator column="entryPrice" /></div>
                    </th>
                    <th className="px-5 py-3.5 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('currentPrice')}>
                      <div className="flex items-center justify-end">LTP <SortIndicator column="currentPrice" /></div>
                    </th>
                    <th className="px-5 py-3.5 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('investedValue')}>
                      <div className="flex items-center justify-end">Invested Value <SortIndicator column="investedValue" /></div>
                    </th>
                    <th className="px-5 py-3.5 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('currentValue')}>
                      <div className="flex items-center justify-end">Current Value <SortIndicator column="currentValue" /></div>
                    </th>
                    <th className="px-5 py-3.5 font-medium text-right cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors" onClick={() => handleSort('pnl')}>
                      <div className="flex items-center justify-end">P&L <SortIndicator column="pnl" /></div>
                    </th>
                    <th className="px-5 py-3.5 font-medium text-center">Action</th>
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
                            <td className={`px-5 py-3.5 ${isSubItem ? 'pl-14' : ''}`}>
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
                                      asOf={priceData?.asOf}
                                      stale={priceData?.stale}
                                      isFetching={isLoadingPrices && !priceData}
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
                            <td className="px-5 py-3.5 text-right font-medium text-zinc-700 dark:text-zinc-300">
                              {item.quantity.toLocaleString('en-IN', { maximumFractionDigits: 6 })}
                              {item.symbol === 'GOLD-INR-GRAM' ? ' g' : ''}
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <div className="text-zinc-900 dark:text-zinc-100 font-mono text-xs">
                                ₹{entryPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              {priceData || item.manualPrice ? (
                                <div className="flex flex-col items-end">
                                  <div className="text-zinc-900 dark:text-zinc-100 font-mono text-xs font-bold">
                                    ₹{currentPrice.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </div>
                                  {priceSource && !isGroupHead && <span className="text-[8px] opacity-40 italic">via {priceSource}</span>}
                                </div>
                              ) : <span className="text-zinc-400 text-xs italic">N/A</span>}
                            </td>
                            <td className="px-5 py-3.5 text-right font-mono text-xs text-zinc-500">
                              ₹{investedValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-5 py-3.5 text-right font-bold text-zinc-900 dark:text-zinc-100 font-mono text-xs">
                              ₹{currentValue.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <div className={`font-bold text-xs ${pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                {pnl >= 0 ? '+' : ''}₹{pnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                              </div>
                              <div className={`text-[10px] ${pnl >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'}`}>
                                {pnl >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-center">
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
                                  <td colSpan={8} className="px-6 py-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                                    <ChevronDown className="w-3 h-3" />
                                    {currentCategory} ({portfolioStats.byCategory[currentCategory]?.assetCount || 0})
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
                                  <td className="px-5 py-3.5 font-bold text-zinc-700 dark:text-zinc-300">
                                    <div className="flex items-center gap-2"><ChevronRight className="w-4 h-4 text-zinc-400" />{currentCategory} ({portfolioStats.byCategory[currentCategory]?.assetCount || 0})</div>
                                  </td>
                                  <td className="px-5 py-3.5 text-right font-medium text-zinc-500">
                                    <span className="text-zinc-400">—</span>
                                  </td>
                                  <td colSpan={2} className="px-5 py-3.5"></td>
                                  <td className="px-5 py-3.5 text-right font-bold text-zinc-900 dark:text-zinc-100">
                                    ₹{stats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-5 py-3.5 text-right font-bold text-zinc-900 dark:text-zinc-100">
                                    ₹{stats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-5 py-3.5 text-right font-bold">
                                    <div className={`${combinedPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                      {combinedPnl >= 0 ? '+' : ''}₹{combinedPnl.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                                    </div>
                                    <div className={`text-xs ${combinedPnl >= 0 ? 'text-emerald-600/80 dark:text-emerald-400/80' : 'text-red-600/80 dark:text-red-400/80'}`}>
                                      {combinedPnl >= 0 ? '+' : ''}{combinedPnlPercent.toFixed(2)}%
                                    </div>
                                  </td>
                                  <td className="px-5 py-3.5"></td>
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
                                      <td colSpan={8} className="px-6 py-2 pl-10 text-[11px] font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                                        <ChevronDown className="w-3 h-3" /> Others (Crypto &lt; ₹10)
                                      </td>
                                    </tr>
                                  ) : (
                                    <tr 
                                      className="bg-zinc-50/30 dark:bg-zinc-900/30 border-t border-zinc-200/50 dark:border-zinc-800/50 cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50 transition-colors"
                                      onClick={() => setExpandedTableCategories(prev => ({ ...prev, 'SmallCrypto': true }))}
                                    >
                                      <td className="px-5 py-2.5 pl-10 font-bold text-zinc-600 dark:text-zinc-400">
                                        <div className="flex items-center gap-2 text-xs"><ChevronRight className="w-3 h-3 text-zinc-400" /> Others (Crypto &lt; ₹10) · {portfolioStats.smallCryptoStats.count} assets</div>
                                      </td>
                                      <td className="px-5 py-2.5 text-right font-medium text-zinc-400 text-xs">—</td>
                                      <td colSpan={2} className="px-5 py-2.5"></td>
                                      <td className="px-5 py-2.5 text-right font-bold text-zinc-700 dark:text-zinc-300 text-xs">₹{portfolioStats.smallCryptoStats.investedValue.toLocaleString('en-IN')}</td>
                                      <td className="px-5 py-2.5 text-right font-bold text-zinc-700 dark:text-zinc-300 text-xs">₹{portfolioStats.smallCryptoStats.currentValue.toLocaleString('en-IN')}</td>
                                      <td className="px-5 py-2.5 text-right font-bold text-xs">
                                        <div className={`${(portfolioStats.smallCryptoStats.currentValue - portfolioStats.smallCryptoStats.investedValue) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                                          {(portfolioStats.smallCryptoStats.currentValue - portfolioStats.smallCryptoStats.investedValue) >= 0 ? '+' : ''}₹{(portfolioStats.smallCryptoStats.currentValue - portfolioStats.smallCryptoStats.investedValue).toLocaleString('en-IN')}
                                        </div>
                                      </td>
                                      <td className="px-5 py-2.5"></td>
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
                        <td className="px-5 py-3.5 text-zinc-900 dark:text-zinc-100 uppercase tracking-wider text-xs flex items-center gap-2">
                          {expandedTableCategories['Total Portfolio'] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                          Total Portfolio
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="text-zinc-400">—</span>
                        </td>
                        <td className="px-5 py-3.5 text-right"></td>
                        <td className="px-5 py-3.5 text-right"></td>
                        <td className="px-5 py-3.5 text-right">
                          ₹{portfolioStats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          ₹{portfolioStats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <div className={`flex flex-col items-end ${totalProfitLoss >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            <span>{totalProfitLoss >= 0 ? '+' : ''}₹{totalProfitLoss.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                            <span className="text-[10px]">({totalProfitLossPercent.toFixed(2)}%)</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5"></td>
                      </tr>
                      {expandedTableCategories['Total Portfolio'] && (
                        <tr className="bg-zinc-50 dark:bg-zinc-950/50">
                          <td colSpan={8} className="px-6 py-6">
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                              {/* Summary Stats */}
                              <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Total Invested</div>
                                <div className="text-lg font-bold">₹{portfolioStats.investedValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                              </div>
                              <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Current Value</div>
                                <div className="text-lg font-bold">₹{portfolioStats.currentValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</div>
                              </div>
                              <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Total P&L</div>
                                <div className={`text-lg font-bold ${totalProfitLoss >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  ₹{totalProfitLoss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                </div>
                              </div>
                              <div className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
                                <div className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Total Returns</div>
                                <div className={`text-lg font-bold ${totalProfitLossPercent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {totalProfitLossPercent >= 0 ? '+' : ''}{totalProfitLossPercent.toFixed(2)}%
                                </div>
                              </div>
                            </div>

                            <div className="mt-6">
                              <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 mb-4 px-1">Category Breakdown</h4>
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
                                    <div key={category} className="p-4 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs">
                                      <div className="flex justify-between items-start mb-2">
                                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{category}</div>
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
          <div className="lg:col-span-1 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-xs overflow-hidden flex flex-col">
            <div className="p-5 border-b border-zinc-200 dark:border-zinc-800">
              <div className="mb-4 flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
                  <List className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold tracking-tight">Top Underlying Exposure</h2>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">Largest positions</p>
                </div>
              </div>
              <div className="flex space-x-1 bg-zinc-100 dark:bg-zinc-800/50 p-1 rounded-lg">
                {(['All', 'Category', 'Sector', 'MarketCap'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => {
                      setExposureTab(tab);
                      setExpandedExposureGroup(null);
                    }}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      exposureTab === tab
                        ? 'bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-xs'
                        : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'
                    }`}
                  >
                    {tab === 'MarketCap' ? 'Market Cap' : tab}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="overflow-y-auto max-h-[500px]">
              {exposureTab === 'All' && topUnderlying.length === 0 ? (
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
                  {exposureTab === 'All' ? (
                    topUnderlying.slice(0, 10).map((item, idx) => {
                      const percentage = ((item.value / portfolioStats.currentValue) * 100).toFixed(1);
                      return (
                        <li key={`${item.symbol || item.name}-${idx}`} className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                          <div className="flex justify-between items-center mb-1.5">
                            <div className="overflow-hidden pr-3">
                              <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">{item.name}</div>
                              <div className="text-xs text-zinc-500 mt-0.5">{item.symbol}</div>
                            </div>
                            <div className="text-right whitespace-nowrap">
                              <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                                ₹{item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                              </div>
                              <div className="text-xs font-bold text-zinc-500 mt-0.5">
                                {percentage}%
                              </div>
                            </div>
                          </div>
                          <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-1.5 mt-1 overflow-hidden">
                            <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, Number(percentage))}%` }}></div>
                          </div>
                        </li>
                      );
                    })
                  ) : (
                    (exposureTab === 'Category' ? groupedAllocationData : exposureTab === 'Sector' ? sectorData : marketCapData)
                      .filter(group => group.value > 0)
                      .map((group, idx) => {
                        const isExpanded = expandedExposureGroup === group.name;
                        const groupPercentage = ((group.value / portfolioStats.currentValue) * 100).toFixed(1);
                        
                        return (
                          <li key={`${group.name}-${idx}`} className="flex flex-col">
                            <button 
                              onClick={() => setExpandedExposureGroup(isExpanded ? null : group.name)}
                              className="w-full text-left p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex flex-col gap-1.5 group cursor-pointer"
                            >
                              <div className="flex justify-between items-center w-full">
                                <div className="flex items-center gap-2">
                                  {exposureTab === 'Category' ? <PieChartIcon className="w-4 h-4 text-zinc-400 group-hover:text-emerald-500 transition-colors" /> :
                                   exposureTab === 'Sector' ? <Briefcase className="w-4 h-4 text-zinc-400 group-hover:text-emerald-500 transition-colors" /> :
                                   <Activity className="w-4 h-4 text-zinc-400 group-hover:text-emerald-500 transition-colors" />}
                                  <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100 truncate">{group.name}</div>
                                  {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-zinc-400" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />}
                                </div>
                                <div className="text-right whitespace-nowrap">
                                  <div className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
                                    ₹{group.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                  </div>
                                  <div className="text-xs font-bold text-zinc-500 mt-0.5">
                                    {groupPercentage}%
                                  </div>
                                </div>
                              </div>
                              <div className="w-full bg-zinc-200 dark:bg-zinc-800 rounded-full h-1 overflow-hidden mt-1 opacity-70">
                                <div className="bg-zinc-400 dark:bg-zinc-500 h-1 rounded-full" style={{ width: `${Math.min(100, Number(groupPercentage))}%` }}></div>
                              </div>
                            </button>
                            
                            {isExpanded && group.constituents && (
                              <div className="bg-zinc-50/50 dark:bg-zinc-800/20 border-t border-zinc-100 dark:border-zinc-800/50 divide-y divide-zinc-100 dark:divide-zinc-800/50">
                                {[...group.constituents]
                                  .sort((a: any, b: any) => b.value - a.value)
                                  .slice(0, 10)
                                  .map((item: any, itemIdx: number) => {
                                    const percentage = ((item.value / portfolioStats.currentValue) * 100).toFixed(1);
                                    return (
                                      <div key={`${item.symbol || item.name}-${itemIdx}`} className="p-3 pl-10 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors">
                                        <div className="flex justify-between items-center mb-1">
                                          <div className="overflow-hidden pr-3">
                                            <div className="font-medium text-sm text-zinc-800 dark:text-zinc-200 truncate">{item.name}</div>
                                            <div className="text-xs text-zinc-500 mt-0.5">{item.symbol}</div>
                                          </div>
                                          <div className="text-right whitespace-nowrap">
                                            <div className="font-medium text-sm text-zinc-800 dark:text-zinc-200">
                                              ₹{item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                            </div>
                                            <div className="text-xs font-bold text-zinc-500 mt-0.5">
                                              {percentage}%
                                            </div>
                                          </div>
                                        </div>
                                        <div className="w-full bg-zinc-200 dark:bg-zinc-700/50 rounded-full h-1 mt-1 overflow-hidden">
                                          <div className="bg-emerald-500 h-1 rounded-full" style={{ width: `${Math.min(100, Number(percentage))}%` }}></div>
                                        </div>
                                      </div>
                                    );
                                  })}
                                {group.constituents.length > 10 && (
                                  <div className="p-2 text-center text-xs text-zinc-500 italic bg-zinc-50 dark:bg-zinc-800/30">
                                    + {group.constituents.length - 10} more assets not shown
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })
                  )}
                </ul>
              )}
            </div>
          </div>
        </div>
      </>
    ) : (
      <Screener onAdd={handleScreenerAdd} />
    )}
        </main>
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
        searchSource={searchSource}
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
