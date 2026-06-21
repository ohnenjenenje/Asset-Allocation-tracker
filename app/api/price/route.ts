import { NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';
import YahooFinance from 'yahoo-finance2';

const yahoo = new YahooFinance();

const safeQuote = async (symbol: string) => {
  try {
    const res = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) throw new Error(`Yahoo direct fetch failed: ${res.status}`);
    const data = await res.json();
    const result = data?.quoteResponse?.result?.[0];
    if (!result) return null;
    return result;
  } catch (e) {
    console.error(`Error in direct Yahoo fetch for ${symbol}:`, e);
    return null;
  }
};

const safeQuoteSummary = async (symbol: string, options: any) => {
  try {
    const modules = options.modules.join(',');
    const res = await fetch(`https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json'
      }
    });
    if (!res.ok) throw new Error(`Yahoo summary fetch failed: ${res.status}`);
    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return null;
    return result;
  } catch (e) {
    console.error(`Error in direct Yahoo summary fetch for ${symbol}:`, e);
    return null;
  }
};

const safeSearch = async (query: string, options: any) => {
  try {
    return await yahoo.search(query, options);
  } catch (e) {
    console.error(`Error in yahoo.search for ${query}:`, e);
    return { quotes: [] };
  }
};

export const dynamic = 'force-dynamic';

// Global cache for sheet data to prevent multiple redundant fetches for sequential chunks
let cachedSheetData: any = null;
let lastSheetFetch = 0;
const CACHE_TTL = 30000; // 30 seconds

const getAuthToken = async () => {
  if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY || !process.env.GOOGLE_SHEET_ID) {
    return null;
  }
  
  try {
    const auth = new GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token;
  } catch (e) {
    console.error("Failed to initialize Google Sheets Auth", e);
    return null;
  }
};

const MANUAL_MAP: Record<string, string> = {
  '0P0001S0S9.BO': '151125', // Zerodha Nifty LargeMidcap 250
  '0P0000XW0K.BO': '102146', // Edelweiss Liquid Fund - Retail
  '0P0011MAX.BO': '120503',  // Axis Small Cap Fund
  'MF_101762': '118955',    // HDFC Flexi Cap Fund - Direct Growth
};

const getMetalPrice = async (metal: string, currency: string = 'INR') => {
  if (!process.env.METALS_API_KEY) return null;
  try {
    const res = await fetch(`https://api.metals.dev/v1/latest?api_key=${process.env.METALS_API_KEY}&currency=${currency}&metals=${metal}`);
    if (res.ok) {
      const data = await res.json();
      if (data.metals && data.metals[metal]) {
        let price = parseFloat(data.metals[metal]);
        return price;
      }
    }
  } catch (e) {
    console.error(`Failed to fetch metal price for ${metal}`, e);
  }
  return null;
};


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    if (!symbolsParam) {
      return NextResponse.json({ error: 'Query parameter "symbols" is required' }, { status: 400 });
    }

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    const refresh = searchParams.get('refresh') === 'true';
    
    // Manual mapping for known problematic Yahoo symbols to AMFI codes
    const MANUAL_MAP: Record<string, string> = {
      '0P0001S0S9.BO': '152156', // Zerodha Nifty LargeMidcap 250
      '0P0000XW0K.BO': '140196', // Edelweiss Liquid Fund - Direct Growth
      '0P0011MAX.BO': '120503',  // Axis Small Cap Fund
      'MF_101762': '118955',    // HDFC Flexi Cap Fund - Direct Growth
      '0P0000XV5G.BO': '140243', // Edelweiss Greater China - Direct
      '0P0000KYO9.BO': '140242', // Edelweiss Greater China - Regular
      'JPPOWER.BO': 'JPPOWER.NS', // JaiPrakash Power Ventures
    };

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
      const isGoldOrSilver = d.symbol === 'GOLD-INR-GRAM' || d.symbol === 'SILVER-INR-GRAM';
      const isMF = d.symbol.startsWith('0P') || /^\d+$/.test(d.symbol) || d.symbol.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(d.symbol);
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
      const getGFinanceSymbol = (sym: string) => {
        if (sym === 'INR=X') return 'CURRENCY:USDINR';
        if (sym.endsWith('=X')) {
          return `CURRENCY:USD${sym.replace('=X', '')}`;
        }
        if (sym.endsWith('.NS')) {
          return `NSE:${sym.replace('.NS', '')}`;
        }
        if (sym.endsWith('.BO') && !sym.startsWith('0P')) {
          return `BSE:${sym.replace('.BO', '')}`;
        }
        if (sym.includes('-')) {
          return `CURRENCY:${sym.replace('-', '')}`;
        }
        return sym;
      };

      // Fetch prices and sectors for symbols to update
      const mfPrices: Record<string, { price: number | null, name: string | null, yahooSymbol: string | null, sector: string | null, source?: string }> = {};
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
            
             // Fetch real metals data (USD per troy ounce futures: GC=F for Gold, SI=F for Silver)
             // We use the exact calculation from USD/troy ounce to INR/gram, using the INR=X exchange rate.
             let priceUsd = await getMetalPrice(metalKey, 'USD');
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
               // 1 Troy Ounce = 31.1034768 grams
               const troyOunceInGrams = 31.1034768;
               
               // Fetch standard USD to INR rate, fallback to 94.22 if unavailable
               const usdToInr = existingData['INR=X']?.regularMarketPrice || 94.22;

               // Base conversion: (USD / Troy Ounce) -> (USD / Gram) -> (INR / Gram)
               let finalInrPrice = (priceUsd / troyOunceInGrams) * usdToInr;
                
               // Import Duty (15%: 10% BCD + 5% AIDC, effective May 2026) + GST (3%)
               const importDutyRate = 0.15;
               const gstRate = 0.03;
               if (sym === 'GOLD-INR-GRAM') {
                 finalInrPrice *= (1 + importDutyRate) * (1 + gstRate);
               } else if (sym === 'SILVER-INR-GRAM') {
                 finalInrPrice *= (1 + importDutyRate) * (1 + gstRate);
               }
               
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
        const isMF = lookupSym.startsWith('0P') || /^\d+$/.test(lookupSym) || lookupSym.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(lookupSym) || lookupSym === 'GOLD-INR-GRAM';
        
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
                    source: 'MFAPI'
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
                const cleanName = fundName
                  .replace(/Direct Plan/gi, '')
                  .replace(/Regular Plan/gi, '')
                  .replace(/Option/gi, '')
                  .replace(/Plan/gi, '')
                  .replace(/Scheme/gi, '')
                  .replace(/Index Fund/gi, '')
                  .replace(/Fund/gi, '')
                  .replace(/Index/gi, '')
                  .replace(/-/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                  
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
                          source: 'MFAPI'
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
                    const cleanName = fundName
                      .replace(/Direct Plan/gi, '').replace(/Regular Plan/gi, '').replace(/Direct/gi, '').replace(/Regular/gi, '')
                      .replace(/Growth/gi, '').replace(/IDCW/gi, '').replace(/Dividend/gi, '').replace(/Option/gi, '')
                      .replace(/Plan/gi, '').replace(/Scheme/gi, '').replace(/Index Fund/gi, '').replace(/Fund/gi, '')
                      .replace(/Index/gi, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
                      
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
                const cleanName = schemeName
                  .replace(/Direct Plan/gi, '')
                  .replace(/Regular Plan/gi, '')
                  .replace(/Direct/gi, '')
                  .replace(/Regular/gi, '')
                  .replace(/Growth/gi, '')
                  .replace(/IDCW/gi, '')
                  .replace(/Dividend/gi, '')
                  .replace(/Option/gi, '')
                  .replace(/Plan/gi, '')
                  .replace(/Scheme/gi, '')
                  .replace(/Index Fund/gi, '')
                  .replace(/Fund/gi, '')
                  .replace(/Index/gi, '')
                  .replace(/-/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                
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
            values: [['Symbol', 'Price', 'Name', 'Currency', 'Type', 'MarketCap', 'YahooSymbol', 'Sector', 'Source']]
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
            values: [['Symbol', 'Price', 'Name', 'Currency', 'Type', 'MarketCap', 'YahooSymbol', 'Sector', 'Source']]
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
          const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(sym) || sym === 'GOLD-INR-GRAM';
          const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO') || sym === 'GOLD-INR-GRAM';
          const isUsdAsset = sym.endsWith('-USD') || (!sym.includes('.') && !isMF);
          
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
          else if (isUsdAsset) currencyFormula = `USD`;

          const typeFormula = sym === 'GOLD-INR-GRAM' ? `COMMODITY` : (isMF ? `MUTUALFUND` : `EQUITY`);
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
          const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(sym) || sym === 'GOLD-INR-GRAM';
          const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO') || sym === 'GOLD-INR-GRAM';
          const isUsdAsset = sym.endsWith('-USD') || (!sym.includes('.') && !isMF);
          
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
          else if (isUsdAsset) currencyFormula = `USD`;

          const typeFormula = sym === 'GOLD-INR-GRAM' ? `COMMODITY` : (isMF ? `MUTUALFUND` : `EQUITY`);
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
        const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(sym) || sym === 'GOLD-INR-GRAM';
        const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO') || sym === 'GOLD-INR-GRAM';
        
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
