import { NextResponse } from 'next/server';
import { MANUAL_MAP as MANUAL_MAP_CONST, SHEET_CACHE_TTL_MS, SHEET_HEADER, USDINR_FALLBACK } from '@/lib/constants';
import { getGFinanceSymbol, isGoldSilverSymbol, isIndianSymbol, isMutualFundSymbol, isUsdAsset } from '@/lib/pricing/symbolClassifier';
import { calculateMetalPricePerGramInr } from '@/lib/pricing/metalPricing';
import { yahooClient } from '@/lib/pricing/yahooClient';
import { metalsClient } from '@/lib/pricing/metalsClient';
import { sheetRepository } from '@/lib/pricing/sheetRepository';
import { cleanFundNameForSearch, mfapiClient } from '@/lib/pricing/mfapiClient';

// DIP: route depends on abstractions, not concrete fetch URLs
const safeQuote = (symbol: string) => yahooClient.quote(symbol);
const safeQuoteSummary = (symbol: string, options: any) => yahooClient.quoteSummary(symbol, options.modules);
const safeSearch = (query: string, options: any) => yahooClient.search(query, options?.quotesCount || 10);

export const dynamic = 'force-dynamic';

// Re-export for testability / SRP (sheetRepository holds cache internally now)
let cachedSheetData: any = null;
let lastSheetFetch = 0;
const CACHE_TTL = SHEET_CACHE_TTL_MS;

const getAuthToken = () => sheetRepository.getAuthToken();

// Keep legacy MANUAL_MAP for backward-compat but delegate to constants; local overrides win
const MANUAL_MAP: Record<string, string> = MANUAL_MAP_CONST;

const getMetalPrice = (metal: string) => metalsClient.getUsdPrice(metal as 'gold' | 'silver');


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    if (!symbolsParam) {
      return NextResponse.json({ error: 'Query parameter "symbols" is required' }, { status: 400 });
    }

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const refresh = searchParams.get('refresh') === 'true';
    
    // MANUAL_MAP now centralized in lib/constants.ts (DIP)

    const token = await getAuthToken();
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!token || !sheetId) {
      return NextResponse.json({ 
        error: 'Google Sheets credentials not configured. Please set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID.' 
      }, { status: 500 });
    }

    // 1. Read existing data
    const now = Date.now();
    let responseData;
    
    if (cachedSheetData && (now - lastSheetFetch < CACHE_TTL) && !refresh) {
      responseData = cachedSheetData;
    } else {
      console.log('Fetching sheet data from Google...');
      const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:I?valueRenderOption=UNFORMATTED_VALUE`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!getRes.ok) {
        const errorText = await getRes.text();
        console.error(`ERROR: Failed to fetch sheet data: ${getRes.status} ${errorText.substring(0, 200)}`);
        throw new Error(`Failed to fetch sheet data: ${getRes.status}`);
      }
      
      responseData = await getRes.json();
      cachedSheetData = responseData;
      lastSheetFetch = now;
      console.log('Successfully fetched and cached sheet data.');
    }
    
    const rows = responseData.values || [];
    const existingData: Record<string, any> = {};
    const existingSymbols = new Set<string>();

    const startIndex = rows.length > 0 && Array.isArray(rows[0]) && typeof rows[0][0] === 'string' && rows[0][0].toLowerCase() === 'symbol' ? 1 : 0;

    for (let i = startIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !Array.isArray(row) || row.length === 0) continue;
      
      const sym = typeof row[0] === 'string' ? row[0].toUpperCase() : String(row[0]);
      if (sym && sym !== 'UNDEFINED' && sym !== 'undefined') {
        existingSymbols.add(sym);
        const priceVal = row[1];
        
        // Handle empty, #N/A, Loading...
        let price = null;
        if (typeof priceVal === 'number') {
          price = priceVal;
        } else if (typeof priceVal === 'string' && !priceVal.includes('#N/A') && !priceVal.includes('Loading')) {
           const parsed = parseFloat(priceVal.replace(/[^0-9.-]+/g, ''));
           if (!isNaN(parsed)) price = parsed;
        }
        
        existingData[sym] = {
          symbol: sym,
          regularMarketPrice: price,
          shortName: row[2] || sym,
          currency: String(row[3] || 'USD').replace(/^"|"$/g, ''),
          quoteType: String(row[4] || 'EQUITY').replace(/^"|"$/g, ''),
          marketCap: typeof row[5] === 'number' ? row[5] : parseFloat(String(row[5] || '').replace(/[^0-9.-]+/g, '')),
          yahooSymbol: row[6] || null,
          sector: row[7] || null,
          source: row[8] || null,
        };
      }
    }

    // 2. Identify missing or broken symbols
    const missingSymbols = symbols.filter(s => !existingSymbols.has(s));
    const brokenSymbols = symbols.filter(s => {
      const d = existingData[s];
      if (!d) return true;
      const isGoldOrSilver = isGoldSilverSymbol(d.symbol);
      const isMF = isMutualFundSymbol(d.symbol);
      const isPriceMissing = d.regularMarketPrice === null;
      const isMarketCapMissing = isNaN(d.marketCap);
      const isYahooSymbolMissing = isMF && !d.yahooSymbol;
      const isSectorMissing = !isMF && !d.sector;
      
      // Mutual funds are static in the sheet, so we consider them 'broken' to force a regular fetch.
      // For Gold/Silver, only force fetch if price is missing.
      return (isMF && !isGoldOrSilver) || (isGoldOrSilver && isPriceMissing) || isPriceMissing || isMarketCapMissing || isYahooSymbolMissing || isSectorMissing;
    });
    
    let symbolsToUpdate = [...new Set([...missingSymbols, ...brokenSymbols])];
    if (refresh) {
      symbolsToUpdate = [...new Set([...symbolsToUpdate, ...symbols])];
    }

    console.log("Missing:", missingSymbols);
    console.log("Broken (price or market cap):", brokenSymbols);
    console.log("To Update:", symbolsToUpdate);

    // Tickertape Fetch array removed
    
    // 4. Append or update symbols
    if (symbolsToUpdate.length > 0) {

      // Fetch prices and sectors for symbols to update
      const mfPrices: Record<string, { price: number | null, name: string | null, yahooSymbol: string | null, sector: string | null, source?: string, quoteType?: string }> = {};
      const stockPrices: Record<string, any> = {};

      await Promise.all(symbolsToUpdate.map(async (sym) => {
        if (sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM') {
          // Check Google Sheet first, unless manual refresh was explicitly requested
          const sheetKeys = sym === 'GOLD-INR-GRAM' ? ['XAUINR'] : ['XAGINR'];
          let sheetPrice = null;
          
          if (!refresh) {
            for (const key of sheetKeys) {
              if (existingData[key] && existingData[key].regularMarketPrice) {
                sheetPrice = existingData[key].regularMarketPrice;
                break;
              }
            }
          }

          if (sheetPrice) {
            mfPrices[sym] = {
              price: sheetPrice,
              name: sym === 'GOLD-INR-GRAM' ? 'Physical Gold 24K (Per Gram)' : 'Physical Silver (Per Gram)',
              yahooSymbol: null,
              sector: 'Precious Metals',
              source: 'Google Sheet'
            };
            return;
          }

          try {
            const metalKey = sym === 'GOLD-INR-GRAM' ? 'gold' : 'silver';
            
             let priceUsd = await getMetalPrice(metalKey);
             let source = '';

             const ySym = sym === 'GOLD-INR-GRAM' ? 'GC=F' : 'SI=F';
             if (priceUsd) {
               source = 'Metals API';
             } else {
               const quote = await safeQuote(ySym) as any;
               if (quote && quote.regularMarketPrice) {
                 priceUsd = quote.regularMarketPrice;
                 source = 'Yahoo Finance';
               }
             }

             if (priceUsd) {
               const usdToInr = existingData['INR=X']?.regularMarketPrice || USDINR_FALLBACK;
               const finalInrPrice = calculateMetalPricePerGramInr(priceUsd, usdToInr);
               
               mfPrices[sym] = {
                 price: finalInrPrice,
                 name: sym === 'GOLD-INR-GRAM' ? 'Physical Gold 24K (Per Gram)' : 'Physical Silver (Per Gram)',
                 yahooSymbol: ySym,
                 sector: 'Precious Metals',
                 source: source
               };
             }
          } catch(e) {
            console.error(`Failed to fetch ${sym} price`, e);
          }
          return;
        }

        const lookupSym = MANUAL_MAP[sym] || sym;
        const isMF = isMutualFundSymbol(lookupSym) || isGoldSilverSymbol(lookupSym);
        
        // If it's a Mutual Fund, prioritize MFAPI
        if (isMF) {
          try {
            let mfapiSuccess = false;
            let schemeName = '';
            
            const amfiCodeMatch = lookupSym.match(/^(?:MF_)?(\d+)$/i);
            if (amfiCodeMatch) {
              const amfiCode = amfiCodeMatch[1];
              const res = await fetch(`https://api.mfapi.in/mf/${amfiCode}`);
              if (res.ok) {
                const data = await res.json();
                if (data.data && data.data.length > 0) {
                  schemeName = data.meta.scheme_name;
                  mfPrices[sym] = {
                    price: parseFloat(data.data[0].nav),
                    name: schemeName,
                    yahooSymbol: sym.startsWith('0P') ? sym : null,
                    sector: null,
                    source: 'MFAPI',
                          quoteType: (data.meta?.scheme_category?.toUpperCase().includes("ETF") || data.meta?.scheme_name?.toUpperCase().includes("ETF")) ? "ETF" : "MUTUALFUND"
                  };
                  mfapiSuccess = true;
                }
              }
            }
            
            // If direct AMFI failed or wasn't provided, try search
            if (!mfapiSuccess) {
              let fundName = existingData[sym]?.shortName;
              if (!fundName || fundName === sym) {
                // Name missing, rely on search API if possible
              }
              
              if (fundName) {
                // Preserve Growth and IDCW as they are critical for identifying the correct fund variant
                const cleanName = cleanFundNameForSearch(fundName);
                  
                const searchRes = await fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(cleanName)}`);
                if (searchRes.ok) {
                  const searchData = await searchRes.json();
                  if (searchData && searchData.length > 0) {
                    const amfiCode = searchData[0].schemeCode;
                    const detailRes = await fetch(`https://api.mfapi.in/mf/${amfiCode}`);
                    if (detailRes.ok) {
                      const detailData = await detailRes.json();
                      if (detailData.data && detailData.data.length > 0) {
                        schemeName = detailData.meta.scheme_name;
                        mfPrices[sym] = {
                          price: parseFloat(detailData.data[0].nav),
                          name: schemeName,
                          yahooSymbol: sym.startsWith('0P') ? sym : null,
                          sector: null,
                          source: 'MFAPI',
                          quoteType: (detailData.meta?.scheme_category?.toUpperCase().includes("ETF") || detailData.meta?.scheme_name?.toUpperCase().includes("ETF")) ? "ETF" : "MUTUALFUND"
                        };
                        mfapiSuccess = true;
                      }
                    }
                  }
                }
              }
            }

            // Fallback to Yahoo Finance if MFAPI failed
            if (!mfapiSuccess) {
              const ySym = existingData[sym]?.yahooSymbol || sym;
              try {
                // Try direct quote first using known Yahoo Symbol or direct symbol
                let result = await safeQuote(ySym) as any;
                let foundYahooSymbol = ySym;
                
                // If it failed to quote correctly, try finding it via Yahoo Search
                if (!result || !result.regularMarketPrice) {
                  let fundName = existingData[sym]?.shortName;
                  if (fundName && fundName !== sym) {
                    const cleanName = cleanFundNameForSearch(fundName);
                      
                    const ySearch = await safeSearch(cleanName, { quotesCount: 10 }) as any;
                    let match = ySearch.quotes.find((q: any) => 
                      (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund') &&
                      (q.symbol.startsWith('0P') || q.symbol.includes('.BO') || q.symbol.includes('.NS'))
                    );
                    
                    if (!match) {
                      const simplerName = cleanName.split(' ').slice(0, 3).join(' ');
                      const ySearch2 = await safeSearch(simplerName, { quotesCount: 10 }) as any;
                      match = ySearch2.quotes.find((q: any) => 
                        (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund') && 
                        (q.symbol.startsWith('0P') || q.symbol.includes('.BO') || q.symbol.includes('.NS'))
                      );
                    }
                    
                    if (match) {
                      foundYahooSymbol = match.symbol;
                      result = await safeQuote(foundYahooSymbol);
                    }
                  }
                }

                if (result && result.regularMarketPrice) {
                  mfPrices[sym] = {
                    price: result.regularMarketPrice,
                    name: result.shortName || result.longName || sym,
                    yahooSymbol: foundYahooSymbol,
                    sector: null,
                    source: 'Yahoo Finance'
                  };
                  mfapiSuccess = true;
                }
              } catch(e) {}
            }

            // If we succeeded with MFAPI (either direct AMFI or via search), try to find Yahoo symbol mapping if missing
            if (mfapiSuccess && !mfPrices[sym].yahooSymbol && schemeName) {
              try {
                const cleanName = cleanFundNameForSearch(schemeName);
                
                const ySearch = await safeSearch(cleanName, { quotesCount: 10 }) as any;
                const match = ySearch.quotes.find((q: any) => 
                  (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund') && 
                  (q.symbol.startsWith('0P') || q.symbol.includes('.BO') || q.symbol.includes('.NS'))
                );
                
                if (match) {
                  mfPrices[sym].yahooSymbol = match.symbol;
                } else {
                  const simplerName = cleanName.split(' ').slice(0, 3).join(' ');
                  const ySearch2 = await safeSearch(simplerName, { quotesCount: 10 }) as any;
                  const match2 = ySearch2.quotes.find((q: any) => 
                    (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund') && 
                    (q.symbol.startsWith('0P') || q.symbol.includes('.BO') || q.symbol.includes('.NS'))
                  );
                  if (match2) {
                    mfPrices[sym].yahooSymbol = match2.symbol;
                  }
                }
              } catch (yErr) {}
            }
          } catch (e) {
            console.error(`Failed to fetch MF price for ${sym}`, e);
          }
          return;
        }

        // For non-MFs (Stocks), use Yahoo Finance
        try {
          const fetchSym = MANUAL_MAP[sym] || sym;
          const quote = await safeQuote(fetchSym) as any;
          if (quote) {
            stockPrices[sym] = {
              symbol: sym,
              regularMarketPrice: quote.regularMarketPrice || 0,
              currency: quote.currency || 'INR',
              shortName: quote.displayName || quote.shortName || sym,
              marketCap: quote.marketCap,
              quoteType: quote.quoteType,
              sector: null,
              source: 'Yahoo Finance',
              lastUpdated: Date.now()
            };
            
            // Try fetching sector separately, it's less critical and often fails
            try {
              const summary = await safeQuoteSummary(fetchSym, { modules: ['assetProfile'] }) as any;
              if (summary && summary.assetProfile && summary.assetProfile.sector) {
                stockPrices[sym].sector = summary.assetProfile.sector;
              }
            } catch (e) {
              // Ignore sector fetch errors
            }
          }
        } catch (e: any) {
          console.error(`Yahoo error for ${sym}, setting fallback:`, e.message);
          stockPrices[sym] = {
            symbol: sym,
            regularMarketPrice: 0,
            currency: 'INR',
            shortName: sym,
            sector: null,
            source: 'Pending Price (Manual update required)',
            lastUpdated: Date.now()
          };
        }
      }));

      // If the sheet is completely empty, add headers first
      if (rows.length === 0) {
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:I1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [[...SHEET_HEADER]]
          })
        });
        if (!res.ok) throw new Error(`Failed to append headers: ${res.status} ${await res.text()}`);
      } else if (rows[0].length < 9) {
        // Update headers if missing the 9th column
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:I1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [[...SHEET_HEADER]]
          })
        });
        if (!res.ok) throw new Error(`Failed to update headers: ${res.status} ${await res.text()}`);
      }

      // Update symbols in place using batchUpdate
      const updateData: any[] = [];
      for (const sym of symbolsToUpdate) {
        const rowIndex = rows.findIndex((r: any) => (typeof r[0] === 'string' ? r[0].toUpperCase() : r[0]) === sym);
        if (rowIndex >= 0) {
          const gSym = getGFinanceSymbol(sym);
          const rowNumber = rowIndex + 1;
          const isMF = isMutualFundSymbol(sym) || isGoldSilverSymbol(sym);
          const isIndian = isIndianSymbol(sym);
          const isUsdAssetSym = isUsdAsset(sym);
          
          let priceFormula = gSym.startsWith('CURRENCY:') ? `=IFNA(GOOGLEFINANCE("${gSym}"), "")` : `=IFNA(GOOGLEFINANCE("${gSym}", "price"), "")`;
          let nameFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "name"), "${sym}")`;
          let yahooSymbol = existingData[sym]?.yahooSymbol || "";
          let sector = existingData[sym]?.sector || "";
          let source = existingData[sym]?.source || "";
          
          if (isMF && mfPrices[sym]) {
            priceFormula = String(mfPrices[sym].price);
            nameFormula = mfPrices[sym].name || sym;
            yahooSymbol = mfPrices[sym].yahooSymbol || yahooSymbol;
            source = mfPrices[sym].source || source;
          } else if (!isMF && stockPrices[sym]) {
            sector = stockPrices[sym].sector || sector;
          }

          if (!source && stockPrices[sym]?.source) {
            source = stockPrices[sym].source;
          }

          let currencyFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "currency"), "INR")`;
          if (isMF || isIndian) currencyFormula = `INR`;
          else if (isUsdAssetSym) currencyFormula = `USD`;

          const actualType = stockPrices[sym]?.quoteType || existingData[sym]?.quoteType || (isMF ? "MUTUALFUND" : "EQUITY");
          const typeFormula = sym === "GOLD-INR-GRAM" ? "COMMODITY" : (actualType === "ETF" ? "ETF" : (isMF ? "MUTUALFUND" : "EQUITY"));
          if (sym === 'GOLD-INR-GRAM') sector = 'Precious Metals';
          
          const fallbackMarketCap = stockPrices[sym]?.marketCap ? stockPrices[sym].marketCap : '""';
          
          // Skip updating the sheet if the symbol is a mutual fund and the value has not changed
          if (isMF && existingData[sym] && existingData[sym].regularMarketPrice === parseFloat(priceFormula)) {
            // Price hasn't drifted, no need to write to sheet
            continue;
          }

          updateData.push({
            range: `A${rowNumber}:I${rowNumber}`,
            values: [[
              sym,
              priceFormula,
              nameFormula,
              currencyFormula,
              typeFormula,
              `=IFNA(GOOGLEFINANCE("${gSym}", "marketcap"), ${fallbackMarketCap})`,
              yahooSymbol,
              sector,
              source
            ]]
          });
        }
      }

      if (updateData.length > 0) {
        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            valueInputOption: 'USER_ENTERED',
            data: updateData
          })
        });
        if (!res.ok) throw new Error(`Failed to batch update: ${res.status} ${await res.text()}`);
      }

      // Append missing symbols
      if (missingSymbols.length > 0) {
        const appendData = missingSymbols.map(sym => {
          const gSym = getGFinanceSymbol(sym);
          const isMF = isMutualFundSymbol(sym) || isGoldSilverSymbol(sym);
          const isIndian = isIndianSymbol(sym);
          const isUsdAssetSym = isUsdAsset(sym);
          
          let priceFormula = gSym.startsWith('CURRENCY:') ? `=IFNA(GOOGLEFINANCE("${gSym}"), "")` : `=IFNA(GOOGLEFINANCE("${gSym}", "price"), "")`;
          let nameFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "name"), "${sym}")`;
          let yahooSymbol = "";
          let sector = "";
          let source = "";
          
          if (isMF && mfPrices[sym]) {
            priceFormula = String(mfPrices[sym].price);
            nameFormula = mfPrices[sym].name || sym;
            yahooSymbol = mfPrices[sym].yahooSymbol || "";
            source = mfPrices[sym].source || "";
          } else if (!isMF && stockPrices[sym]) {
            sector = stockPrices[sym].sector || "";
            source = stockPrices[sym].source || "";
          }



          let currencyFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "currency"), "INR")`;
          if (isMF || isIndian) currencyFormula = `INR`;
          else if (isUsdAssetSym) currencyFormula = `USD`;

          const actualType = stockPrices[sym]?.quoteType || existingData[sym]?.quoteType || (isMF ? "MUTUALFUND" : "EQUITY");
          const typeFormula = sym === "GOLD-INR-GRAM" ? "COMMODITY" : (actualType === "ETF" ? "ETF" : (isMF ? "MUTUALFUND" : "EQUITY"));
          if (sym === 'GOLD-INR-GRAM') sector = 'Precious Metals';
          
          const fallbackMarketCap = stockPrices[sym]?.marketCap ? stockPrices[sym].marketCap : '""';
          
          return [
            sym,
            priceFormula,
            nameFormula,
            currencyFormula,
            typeFormula,
            `=IFNA(GOOGLEFINANCE("${gSym}", "marketcap"), ${fallbackMarketCap})`,
            yahooSymbol,
            sector,
            source
          ];
        });

        const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:I:append?valueInputOption=USER_ENTERED`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: appendData
          })
        });
        if (!res.ok) throw new Error(`Failed to append missing symbols: ${res.status} ${await res.text()}`);
      }

      symbolsToUpdate.forEach(sym => {
        const isMF = isMutualFundSymbol(sym) || isGoldSilverSymbol(sym);
        const isIndian = isIndianSymbol(sym);
        
        let source = existingData[sym]?.source || "";
        if (isMF && mfPrices[sym]) {
          source = mfPrices[sym].source || source;
        } else if (!isMF && stockPrices[sym]) {
          source = stockPrices[sym].source || source;
        }

        if (!existingData[sym]) {
          existingData[sym] = {
            symbol: sym,
            regularMarketPrice: mfPrices[sym]?.price || stockPrices[sym]?.regularMarketPrice || null,
            shortName: mfPrices[sym]?.name || stockPrices[sym]?.shortName || sym,
            currency: mfPrices[sym] ? 'INR' : (stockPrices[sym]?.currency || (isMF ? 'INR' : (isIndian ? 'INR' : 'USD'))),
            quoteType: (sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM') ? 'COMMODITY' : (isMF ? 'MUTUALFUND' : (stockPrices[sym]?.quoteType || 'EQUITY')),
            marketCap: stockPrices[sym]?.marketCap || null,
            yahooSymbol: mfPrices[sym]?.yahooSymbol || null,
            sector: (sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM') ? 'Precious Metals' : (isMF ? null : (stockPrices[sym]?.sector || null)),
            source: source || null
          };
        } else {
          existingData[sym].source = source || existingData[sym].source;
          if (stockPrices[sym]) {
            existingData[sym].regularMarketPrice = stockPrices[sym].regularMarketPrice || existingData[sym].regularMarketPrice;
            existingData[sym].marketCap = stockPrices[sym].marketCap || existingData[sym].marketCap;
          }
          if (sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM') {
            existingData[sym].quoteType = 'COMMODITY';
            existingData[sym].sector = 'Precious Metals';
            existingData[sym].currency = 'INR';
            if (mfPrices[sym]) {
              existingData[sym].regularMarketPrice = mfPrices[sym].price;
              existingData[sym].shortName = mfPrices[sym].name;
              existingData[sym].yahooSymbol = mfPrices[sym].yahooSymbol;
              existingData[sym].source = mfPrices[sym].source;
            }
          } else if (isMF) {
            existingData[sym].quoteType = 'MUTUALFUND';
            if (mfPrices[sym]) {
              existingData[sym].regularMarketPrice = mfPrices[sym].price;
              existingData[sym].shortName = mfPrices[sym].name;
              existingData[sym].yahooSymbol = mfPrices[sym].yahooSymbol || existingData[sym].yahooSymbol;
            }
          } else if (stockPrices[sym]) {
            existingData[sym].sector = stockPrices[sym].sector || existingData[sym].sector;
          }
        }
      });
    }

    // 4. Return requested symbols
    const results = symbols.map(sym => existingData[sym]).filter(Boolean);
    return NextResponse.json(results);

  } catch (error: any) {
    console.error('Price API fatal error:', error);
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      message: error.message || String(error) 
    }, { status: 500 });
  }
}
