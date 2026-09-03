import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Asset, PriceData, ChatMessage } from '@/lib/types';
import { guessCurrency } from '@/lib/portfolio-utils';
import { createAiProvider } from '@/lib/ai/providerFactory';

interface UseAiChatParams {
  assets: Asset[];
  setAssets: React.Dispatch<React.SetStateAction<Asset[]>>;
  fundHoldings: Record<string, any>;
  setFundHoldings: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  prices: Record<string, PriceData>;
  fetchPrices: (forceRefresh?: boolean, specificSymbols?: string[]) => Promise<void>;
  syncToDb: (updates: any) => Promise<void>;
  openRouterKey: string;
  aiProvider: 'openrouter' | 'google';
  selectedModel: string;
  googleModel: string;
  availableModels: any[];
  searchSource: 'indianapi' | 'yahoo' | 'newapi' | 'tickertape';
  setIsAddModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useAiChat({
  assets,
  setAssets,
  fundHoldings,
  setFundHoldings,
  prices,
  fetchPrices,
  syncToDb,
  openRouterKey,
  aiProvider,
  selectedModel,
  googleModel,
  availableModels,
  searchSource,
  setIsAddModalOpen,
  setIsSettingsOpen
}: UseAiChatParams) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: 'Hi! I can help you manage your portfolio. Try saying "Add 10 shares of Apple at $150" or "Remove Reliance".' }]);
  const [aiInput, setAiInput] = useState('');
  const [isAiTyping, setIsAiTyping] = useState(false);

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

  // OCP/DIP: provider abstraction — add new AI provider without editing this hook
  const callOpenRouter = async (messages: any[], tools: any[]) => {
    const provider = createAiProvider({ aiProvider, openRouterKey, availableModels, googleModel });
    // Note: callOpenRouter name kept for backward-compat; now delegates to provider
    return provider.chat({ messages, tools, model: selectedModel, openRouterKey, googleModel, availableModels });
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

  return {
    isChatOpen, setIsChatOpen,
    chatMessages, setChatMessages,
    aiInput, setAiInput,
    isAiTyping,
    messagesEndRef,
    chatContainerRef,
    scrollToBottom,
    scrollToTop,
    startNewChat,
    handleAiCommand,
  };
}
