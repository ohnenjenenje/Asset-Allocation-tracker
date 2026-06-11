import { useState, useEffect, useCallback, useRef } from 'react';
import { Asset, PriceData } from '@/lib/types';

export function usePrices(assets: Asset[], fundHoldings: Record<string, any>) {
  const [prices, setPrices] = useState<Record<string, PriceData>>({});
  const pricesRef = useRef(prices);

  useEffect(() => {
    pricesRef.current = prices;
  }, [prices]);

  const [isLoadingPrices, setIsLoadingPrices] = useState(false);

  const fetchPrices = useCallback(async (forceRefresh = false, specificSymbols?: string[]) => {
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
      
      if (specificSymbols) {
        symbols = symbols.filter(s => specificSymbols.includes(s));
      } else if (!forceRefresh) {
        symbols = symbols.filter(s => !pricesRef.current[s]);
      } else {
        symbols = symbols.filter(s => {
          if (!pricesRef.current[s]) return true;
          if (s === 'GOLD-INR-GRAM' || s === 'SILVER-INR-GRAM' || s === 'CASH-INR') return false;
          return true;
        });
      }

      if (symbols.length === 0) {
        setIsLoadingPrices(false);
        return;
      }

      const newPrices: Record<string, PriceData> = {};
      
      const chunkSize = 8;
      for (let i = 0; i < symbols.length; i += chunkSize) {
        // Wait between chunks to prevent overwhelming the API
        if (i > 0) await new Promise(r => setTimeout(r, 1200));
        
        const chunk = symbols.slice(i, i + chunkSize);
        
        let retries = 5; // Increased retries
        let success = false;
        
        while (retries >= 0 && !success) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout per chunk
          
          try {
            const res = await fetch(`/api/price?symbols=${encodeURIComponent(chunk.join(','))}${forceRefresh ? '&refresh=true' : ''}`, {
              signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (!res.ok) {
              const errBody = await res.text().catch(() => 'No body');
              const error = new Error(`Price API status ${res.status}: ${errBody.substring(0, 100)}`);
              (error as any).status = res.status;
              throw error;
            }

            const contentType = res.headers.get('content-type');
            const text = await res.text();
            
            if (!contentType || !contentType.includes('application/json')) {
              const isHtml = text.trim().startsWith('<');
              if (!isHtml) {
                console.error(`Non-JSON content-type: ${contentType}. Body: ${text.substring(0, 200)}`);
              }
              const error = new Error(`Non-JSON content-type: ${contentType}`);
              (error as any).isHtml = isHtml;
              throw error;
            }

            const data = JSON.parse(text);
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
            const isHtml = err.isHtml;
            
            if (!isHtml) {
              console.error(`Attempt ${6 - retries} failed for chunk ${i} (Symbols: ${chunk.join(', ')}) (${isTimeout ? 'Timeout' : 'Error'}):`, err.message || err);
            }
            
            retries--;
            if (retries >= 0) {
                // If it's a HTML response (likely "Starting Server...") or 503 (Server Unavailable), wait longer
                const isSlowResponse = isHtml || err.status === 503;
                const backoff = isSlowResponse ? 15000 : 5000;
                if (!isHtml) console.log(`Retrying in ${backoff}ms...`);
                await new Promise(r => setTimeout(r, backoff)); 
            } else {
              if (isHtml) console.error(`Failed to fetch chunk ${i} after all retries (received HTML response)`);
            }
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
      }, 60000);
      return () => clearInterval(interval);
    }
  }, [assets, fetchPrices]);

  return { prices, setPrices, isLoadingPrices, fetchPrices };
}
