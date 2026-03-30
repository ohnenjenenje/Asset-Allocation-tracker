'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Search, Trash2, RefreshCw, TrendingUp, TrendingDown, DollarSign, PieChart as PieChartIcon, BarChart3, List, MessageCircle, Settings, X, Send, Bot } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI, Type } from '@google/genai';

type Asset = {
  id: string;
  symbol: string;
  name: string;
  quantity: number;
  entryPrice: number;
  type: string;
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
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [fundHoldings, setFundHoldings] = useState<Record<string, any[]>>({});
  const loadingHoldings = useRef<Record<string, boolean>>({});

  // AI State
  const [openRouterKey, setOpenRouterKey] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: 'Hi! I can help you manage your portfolio. Try saying "Add 10 shares of Apple at $150" or "Remove Reliance".' }]);
  const [aiInput, setAiInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);
  const [aiProvider, setAiProvider] = useState<'openrouter' | 'google'>('openrouter');
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [selectedModel, setSelectedModel] = useState('openrouter/free');
  const [googleModel, setGoogleModel] = useState('gemini-3.1-flash-preview');

  useEffect(() => {
    const savedAssets = localStorage.getItem('portfolio_assets');
    if (savedAssets) {
      try {
        setAssets(JSON.parse(savedAssets));
      } catch (e) {
        console.error('Failed to parse saved assets', e);
      }
    }
    const savedKey = localStorage.getItem('openrouter_key');
    if (savedKey) setOpenRouterKey(savedKey);

    const savedProvider = localStorage.getItem('ai_provider');
    if (savedProvider === 'google' || savedProvider === 'openrouter') {
      setAiProvider(savedProvider);
    }

    const savedGoogleModel = localStorage.getItem('google_model');
    if (savedGoogleModel) {
      setGoogleModel(savedGoogleModel);
    }

    const savedModel = localStorage.getItem('openrouter_model');
    if (savedModel) {
      if (savedModel === 'google/gemini-2.5-flash:free') {
        setSelectedModel('openrouter/free');
        localStorage.setItem('openrouter_model', 'openrouter/free');
      } else {
        setSelectedModel(savedModel);
      }
    }

    // Fetch available free models
    fetch('/api/models')
      .then(res => res.json())
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
      if ((asset.type === 'MUTUALFUND' || asset.type === 'ETF') && !fundHoldings[asset.symbol] && !loadingHoldings.current[asset.symbol]) {
        loadingHoldings.current[asset.symbol] = true;
        fetch(`/api/holdings?symbol=${encodeURIComponent(asset.symbol)}`)
          .then(res => res.json())
          .then(data => {
            if (data.holdings && data.holdings.length > 0) {
              setFundHoldings(prev => ({ ...prev, [asset.symbol]: data.holdings }));
            }
          })
          .catch(console.error);
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

      Object.values(fundHoldings).forEach(holdings => {
        holdings.forEach(h => {
          if (h.symbol) symbolsSet.add(h.symbol);
        });
      });

      const symbols = Array.from(symbolsSet);
      const newPrices: Record<string, PriceData> = {};
      
      const chunkSize = 20;
      for (let i = 0; i < symbols.length; i += chunkSize) {
        const chunk = symbols.slice(i, i + chunkSize);
        const res = await fetch(`/api/price?symbols=${chunk.join(',')}`);
        const data = await res.json();
        
        if (res.ok && Array.isArray(data)) {
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
          const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
          const data = await res.json();
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

  const handleAddAsset = () => {
    if (!selectedResult || !quantity || !entryPrice) return;

    const newAsset: Asset = {
      id: uuidv4(),
      symbol: selectedResult.symbol,
      name: selectedResult.shortname || selectedResult.longname || selectedResult.symbol,
      quantity: parseFloat(quantity),
      entryPrice: parseFloat(entryPrice),
      type: selectedResult.quoteType || 'UNKNOWN',
    };

    const newAssets = [...assets, newAsset];
    setAssets(newAssets);
    localStorage.setItem('portfolio_assets', JSON.stringify(newAssets));
    
    setIsAddModalOpen(false);
    resetForm();
  };

  const handleDeleteAsset = (id: string) => {
    const newAssets = assets.filter(a => a.id !== id);
    setAssets(newAssets);
    localStorage.setItem('portfolio_assets', JSON.stringify(newAssets));
  };

  const resetForm = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResult(null);
    setQuantity('');
    setEntryPrice('');
  };

  const saveOpenRouterKey = (key: string) => {
    setOpenRouterKey(key);
    localStorage.setItem('openrouter_key', key);
    setIsSettingsOpen(false);
  };

  const callOpenRouter = async (messages: any[], tools: any[]) => {
    if (aiProvider === 'google') {
      const ai = new GoogleGenAI({ apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY });
      
      const systemPrompt = messages.find(m => m.role === 'system')?.content;
      
      const geminiMessages = messages.filter(m => m.role !== 'system').map(m => {
        if (m.role === 'tool') {
          return {
            role: 'user',
            parts: [{
              functionResponse: {
                name: m.name,
                response: { result: m.content }
              }
            }]
          };
        }
        if (m.tool_calls) {
          return {
            role: 'model',
            parts: m.tool_calls.map((tc: any) => ({
              functionCall: {
                name: tc.function.name,
                args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
              }
            }))
          };
        }
        return {
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content || '' }]
        };
      });

      const geminiTools = tools ? [{
        functionDeclarations: tools.map((t: any) => ({
          name: t.function.name,
          description: t.function.description,
          parameters: {
            type: Type.OBJECT,
            properties: Object.fromEntries(
              Object.entries(t.function.parameters.properties).map(([k, v]: [string, any]) => [
                k,
                { type: v.type === 'number' ? Type.NUMBER : Type.STRING, description: v.description }
              ])
            ),
            required: t.function.parameters.required
          }
        }))
      }] : undefined;

      const response = await ai.models.generateContent({
        model: googleModel,
        contents: geminiMessages,
        config: {
          systemInstruction: systemPrompt,
          tools: geminiTools
        }
      });

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        return {
          model: googleModel,
          choices: [{
            message: {
              role: 'assistant',
              content: null,
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
            content: response.text
          }
        }]
      };
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: messages,
        tools: tools,
        key: openRouterKey
      })
    });
    if (!res.ok) {
      const err = await res.json();
      let errorMessage = err.error?.message || 'Failed to call OpenRouter';
      if (errorMessage.includes('guardrail restrictions and data policy')) {
        errorMessage = 'The selected free model requires data logging. Please either enable data collection at https://openrouter.ai/settings/privacy or select a different model.';
      } else if (errorMessage.includes('requires more credits')) {
        errorMessage = 'This model requires paid credits. Please select a free model from the settings, or add credits to your OpenRouter account.';
      } else if (errorMessage.includes('Provider returned error') || errorMessage.includes('upstream error')) {
        errorMessage = 'The selected AI model is currently experiencing issues or is unavailable. Please select a different model in the settings.';
      }
      throw new Error(errorMessage);
    }
    return await res.json();
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
              entryPrice: { type: 'number', description: 'The average purchase price per unit' }
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
      }
    ];

    try {
      let currentMessages = [...newMessages];
      const systemPrompt = { 
        role: 'system', 
        content: `You are a helpful portfolio management assistant. You can help users add or remove assets from their portfolio using the provided tools. 
        If the user does not provide a price or quantity when adding, ask them for it before calling the tool. 
        Current portfolio symbols: ${assets.map(a => a.symbol).join(', ')}` 
      };
      
      let response = await callOpenRouter([systemPrompt, ...currentMessages], tools);
      if (!response.choices || response.choices.length === 0) {
        throw new Error(response.error?.message || 'The AI model returned an empty response. It might be overloaded or unavailable.');
      }
      let message = response.choices[0].message;

      if (message.tool_calls) {
        currentMessages.push(message);
        
        for (const toolCall of message.tool_calls) {
          let args;
          try {
            args = typeof toolCall.function.arguments === 'string' 
              ? JSON.parse(toolCall.function.arguments) 
              : toolCall.function.arguments;
          } catch (e: any) {
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Error parsing arguments: ${e.message}. Please ensure you provide valid JSON.`
            });
            continue;
          }

          if (toolCall.function.name === 'add_asset') {
            const searchRes = await fetch(`/api/search?q=${encodeURIComponent(args.query || '')}`);
            const searchData = await searchRes.json();
            
            if (searchData && searchData.length > 0) {
              const selected = searchData[0];
              const newAsset: Asset = {
                id: uuidv4(),
                symbol: selected.symbol,
                name: selected.shortname || selected.longname || selected.symbol,
                quantity: args.quantity,
                entryPrice: args.entryPrice,
                type: selected.quoteType || 'UNKNOWN',
              };
              
              setAssets(prev => {
                const updated = [...prev, newAsset];
                localStorage.setItem('portfolio_assets', JSON.stringify(updated));
                return updated;
              });
              
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: `Successfully added ${newAsset.name} (${newAsset.symbol}) to the portfolio.`
              });
            } else {
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                name: toolCall.function.name,
                content: `Could not find any asset matching "${args.query}".`
              });
            }
          } else if (toolCall.function.name === 'remove_asset') {
            setAssets(prev => {
              const updated = prev.filter(a => a.symbol.toLowerCase() !== (args.symbol || '').toLowerCase());
              localStorage.setItem('portfolio_assets', JSON.stringify(updated));
              return updated;
            });
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: `Successfully removed ${args.symbol} from the portfolio.`
            });
          }
        }
        
        response = await callOpenRouter([systemPrompt, ...currentMessages], tools);
        if (!response.choices || response.choices.length === 0) {
          throw new Error(response.error?.message || 'The AI model returned an empty response. It might be overloaded or unavailable.');
        }
        message = response.choices[0].message;
      }

      if (message.content) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: message.content, model: response.model }]);
      }
    } catch (error: any) {
      console.error("AI Error:", error);
      setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${error.message}` }]);
    } finally {
      setIsAiTyping(false);
    }
  };

  const usdToInr = prices['INR=X']?.regularMarketPrice || 83;

  const getConvertedPrice = (price: number, currency: string) => {
    if (currency === 'USD') return price * usdToInr;
    if (currency === 'GBp') return (price / 100) * 105; // Approx GBP to INR
    return price;
  };

  const portfolioStats = assets.reduce((acc, asset) => {
    const priceData = prices[asset.symbol];
    const currentPrice = priceData ? getConvertedPrice(priceData.regularMarketPrice, priceData.currency) : asset.entryPrice;
    const entryPriceConverted = priceData ? getConvertedPrice(asset.entryPrice, priceData.currency) : asset.entryPrice; // Assuming entry price is in native currency
    
    const currentValue = currentPrice * asset.quantity;
    const investedValue = entryPriceConverted * asset.quantity;
    
    acc.currentValue += currentValue;
    acc.investedValue += investedValue;
    
    return acc;
  }, { currentValue: 0, investedValue: 0 });

  const totalProfitLoss = portfolioStats.currentValue - portfolioStats.investedValue;
  const totalProfitLossPercent = portfolioStats.investedValue > 0 ? (totalProfitLoss / portfolioStats.investedValue) * 100 : 0;

  const allocationData = assets.reduce((acc: any[], asset) => {
    const priceData = prices[asset.symbol];
    const currentPrice = priceData ? getConvertedPrice(priceData.regularMarketPrice, priceData.currency) : asset.entryPrice;
    const value = currentPrice * asset.quantity;
    
    const existingType = acc.find(item => item.name === asset.type);
    if (existingType) {
      existingType.value += value;
    } else {
      acc.push({ name: asset.type, value });
    }
    return acc;
  }, []);

  const underlyingExposure: Record<string, { symbol: string, name: string, value: number, type: string, marketCap?: number, currency?: string }> = {};

  assets.forEach(asset => {
    const priceData = prices[asset.symbol];
    const currentPriceRaw = priceData?.regularMarketPrice || asset.entryPrice;
    const currency = priceData?.currency || 'INR';
    const currentPrice = getConvertedPrice(currentPriceRaw, currency);
    const totalValue = currentPrice * asset.quantity;

    const holdings = fundHoldings[asset.symbol];
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
            currency: prices[h.symbol]?.currency || 'INR'
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
          currency: currency
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
    if ((exp.type === 'EQUITY' || exp.type === 'EQUITY') && exp.marketCap) {
      const capInUsd = exp.currency === 'INR' ? exp.marketCap / usdToInr : exp.marketCap;
      if (capInUsd >= 10_000_000_000) marketCapAllocation['Large Cap'] += exp.value;
      else if (capInUsd >= 2_000_000_000) marketCapAllocation['Mid Cap'] += exp.value;
      else marketCapAllocation['Small Cap'] += exp.value;
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
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
            <button 
              onClick={fetchPrices}
              disabled={isLoadingPrices || assets.length === 0}
              className="p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
              title="Refresh Prices"
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
              <div className="flex-1 min-h-[300px]">
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
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
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
              <div className="flex-1 min-h-[300px]">
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
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
                Add equities to see market cap
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Asset List */}
          <div className="lg:col-span-2 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="text-lg font-semibold">Your Assets</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-950/50 text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-4 font-medium">Asset</th>
                    <th className="px-6 py-4 font-medium text-right">Holdings</th>
                    <th className="px-6 py-4 font-medium text-right">Avg. Price</th>
                    <th className="px-6 py-4 font-medium text-right">LTP</th>
                    <th className="px-6 py-4 font-medium text-right">Current Value</th>
                    <th className="px-6 py-4 font-medium text-right">P&L</th>
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
                    assets.map((asset) => {
                      const priceData = prices[asset.symbol];
                      const currentPriceRaw = priceData?.regularMarketPrice || asset.entryPrice;
                      const currency = priceData?.currency || 'INR';
                      
                      const currentPrice = getConvertedPrice(currentPriceRaw, currency);
                      const entryPrice = getConvertedPrice(asset.entryPrice, currency);
                      
                      const currentValue = currentPrice * asset.quantity;
                      const investedValue = entryPrice * asset.quantity;
                      const pnl = currentValue - investedValue;
                      const pnlPercent = investedValue > 0 ? (pnl / investedValue) * 100 : 0;
                      
                      return (
                        <tr key={asset.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-medium text-zinc-900 dark:text-zinc-100">{asset.name}</div>
                            <div className="text-xs text-zinc-500">{asset.symbol} &bull; {asset.type}</div>
                          </td>
                          <td className="px-6 py-4 text-right font-medium">
                            {asset.quantity.toLocaleString('en-IN')}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <div className="text-zinc-900 dark:text-zinc-100">{asset.entryPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                            <div className="text-xs text-zinc-500">{currency}</div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {priceData ? (
                              <>
                                <div className="text-zinc-900 dark:text-zinc-100">{currentPriceRaw.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</div>
                                <div className="text-xs text-zinc-500">{currency}</div>
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
                            <button 
                              onClick={() => handleDeleteAsset(asset.id)}
                              className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors"
                              title="Remove Asset"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
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
                  No exposure data available
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
              <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Add Asset</h2>
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
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl flex justify-between items-center">
                  <div className="overflow-hidden pr-2">
                    <div className="font-medium text-blue-900 dark:text-blue-100 truncate">{selectedResult.shortname || selectedResult.longname}</div>
                    <div className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">{selectedResult.symbol}</div>
                  </div>
                  <button 
                    onClick={() => {
                      setSelectedResult(null);
                      setSearchQuery('');
                    }}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium whitespace-nowrap"
                  >
                    Change
                  </button>
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
                    <input 
                      type="number" 
                      step="any"
                      min="0"
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      value={entryPrice}
                      onChange={(e) => setEntryPrice(e.target.value)}
                      placeholder="e.g. 1500.50"
                    />
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
                  Add Asset
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
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">AI Provider</label>
                <select
                  value={aiProvider}
                  onChange={(e) => {
                    const val = e.target.value as 'openrouter' | 'google';
                    setAiProvider(val);
                    localStorage.setItem('ai_provider', val);
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
                        value={availableModels.some(m => m.id === selectedModel) || selectedModel === 'openrouter/free' ? selectedModel : 'custom'}
                        onChange={(e) => {
                          if (e.target.value === 'custom') {
                            setSelectedModel('');
                            localStorage.setItem('openrouter_model', '');
                          } else {
                            setSelectedModel(e.target.value);
                            localStorage.setItem('openrouter_model', e.target.value);
                          }
                        }}
                        className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                      >
                        <option value="openrouter/free">OpenRouter Free (Auto-selects best free model)</option>
                        {availableModels.map(model => (
                          <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                        <option value="custom">Custom Model...</option>
                      </select>
                      
                      {(!availableModels.some(m => m.id === selectedModel) && selectedModel !== 'openrouter/free') && (
                        <input
                          type="text"
                          value={selectedModel}
                          onChange={(e) => {
                            setSelectedModel(e.target.value);
                            localStorage.setItem('openrouter_model', e.target.value);
                          }}
                          placeholder="e.g., anthropic/claude-3-opus"
                          className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                          autoFocus
                        />
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-2">
                      Select a free model from the list or choose "Custom Model..." to type any OpenRouter model ID.
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
                      localStorage.setItem('google_model', e.target.value);
                    }}
                    className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                  >
                    <option value="gemini-3.1-flash-preview">Gemini 3.1 Flash (Fast & Capable)</option>
                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Advanced Reasoning)</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
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

      {/* Floating Chat Widget */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end">
        {isChatOpen && (
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl w-80 sm:w-96 h-[500px] max-h-[70vh] mb-4 border border-zinc-200 dark:border-zinc-800 flex flex-col overflow-hidden animate-in slide-in-from-bottom-5">
            <div className="p-4 bg-blue-600 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                <h3 className="font-semibold">AI Assistant</h3>
              </div>
              <button onClick={() => setIsChatOpen(false)} className="text-blue-100 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-50 dark:bg-zinc-950/50">
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

    </div>
  );
}
