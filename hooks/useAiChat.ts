import { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenAI, Type, ThinkingLevel } from '@google/genai';
import { Asset, PriceData, ChatMessage } from '@/lib/types';
import { guessCurrency } from '@/lib/portfolio-utils';

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
