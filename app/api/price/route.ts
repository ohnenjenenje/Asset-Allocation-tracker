import { NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';
import yahooFinance from 'yahoo-finance2/dist/cjs/src/index.js';

const yahoo = yahooFinance;

export const dynamic = 'force-dynamic';

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
};

async function fetchTickertapeQuotes(symbols: string[]) {
  const results: Record<string, any> = {};
  const sidsToFetch: string[] = [];
  const symbolToSid: Record<string, string> = {};

  for (const sym of symbols) {
    const lookupSym = MANUAL_MAP[sym] || sym;
    if (lookupSym.endsWith('.NS') || lookupSym.endsWith('.BO')) {
      const ticker = lookupSym.split('.')[0];
      sidsToFetch.push(ticker);
      symbolToSid[sym] = ticker;
    } else if (/^\d+$/.test(lookupSym)) {
      const sid = `MF_${lookupSym}`;
      sidsToFetch.push(sid);
      symbolToSid[sym] = sid;
    } else if (lookupSym.startsWith('MF_')) {
      sidsToFetch.push(lookupSym);
      symbolToSid[sym] = lookupSym;
    } else if (lookupSym.startsWith('0P')) {
       // For 0P symbols, we might need to search for SID first
       // But we'll skip for now and rely on Yahoo/MFAPI if not in MANUAL_MAP
    }
  }

  if (sidsToFetch.length === 0) return results;

  try {
    const stockSids = sidsToFetch.filter(s => !s.startsWith('MF_'));
    const mfSids = sidsToFetch.filter(s => s.startsWith('MF_'));

    if (stockSids.length > 0) {
      const res = await fetch(`https://api.tickertape.in/v2/stocks/quotes?sids=${stockSids.join(',')}`);
      if (res.ok) {
        const data = await res.json();
        (data.data || []).forEach((q: any) => {
          const sym = Object.keys(symbolToSid).find(k => symbolToSid[k] === q.sid);
          if (sym) {
            results[sym] = {
              price: q.price,
              name: q.name,
              marketCap: q.mcap,
              sector: q.sector,
              quoteType: 'EQUITY',
              sid: q.sid,
              source: 'Tickertape'
            };
          }
        });
      }
    }

    for (const sid of mfSids) {
      try {
        const res = await fetch(`https://api.tickertape.in/mf/${sid}/portfolio`);
        if (res.ok) {
          const data = await res.json();
          const q = data.data || {};
          const sym = Object.keys(symbolToSid).find(k => symbolToSid[k] === sid);
          if (sym && q.info) {
            results[sym] = {
              price: q.info.nav || q.nav,
              name: q.info.name || q.name,
              quoteType: 'MUTUALFUND',
              sid: sid,
              source: 'Tickertape'
            };
          }
        }
      } catch (e) {}
    }
  } catch (e) {
    console.error("Tickertape bulk fetch error:", e);
  }
  return results;
}

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
    };

    const token = await getAuthToken();
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!token || !sheetId) {
      return NextResponse.json({ 
        error: 'Google Sheets credentials not configured. Please set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID.' 
      }, { status: 500 });
    }

    // 1. Read existing data
    const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:I?valueRenderOption=UNFORMATTED_VALUE`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!getRes.ok) {
      const errorText = await getRes.text();
      throw new Error(`Failed to fetch sheet data: ${getRes.status} ${errorText.substring(0, 200)}`);
    }
    
    const responseData = await getRes.json();
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
      if (!d) return false;
      const isMF = d.symbol.startsWith('0P') || /^\d+$/.test(d.symbol) || d.symbol.startsWith('MF_') || d.symbol === 'GOLD-INR-GRAM';
      const isPriceMissing = d.regularMarketPrice === null;
      const isMarketCapMissing = isNaN(d.marketCap);
      const isYahooSymbolMissing = isMF && !d.yahooSymbol;
      const isSectorMissing = !isMF && !d.sector;
      return isPriceMissing || isMarketCapMissing || isYahooSymbolMissing || isSectorMissing;
    });
    
    let symbolsToUpdate = [...new Set([...missingSymbols, ...brokenSymbols])];
    if (refresh) {
      symbolsToUpdate = [...new Set([...symbolsToUpdate, ...symbols])];
    }

    console.log("Missing:", missingSymbols);
    console.log("Broken (price or market cap):", brokenSymbols);
    console.log("To Update:", symbolsToUpdate);

    // 3. Fetch data from Tickertape for Indian assets (Stocks first, MFs as secondary)
    const ttResults = await fetchTickertapeQuotes(symbolsToUpdate);
    
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
      const stockSectors: Record<string, string | null> = {};
      const stockMarketCaps: Record<string, number | null> = {};
      const stockSources: Record<string, string> = {};

      await Promise.all(symbolsToUpdate.map(async (sym) => {
        if (sym === 'GOLD-INR-GRAM') {
          try {
            const quote = await yahoo.quote('XAUINR=X') as any;
            if (quote && quote.regularMarketPrice) {
               mfPrices[sym] = {
                 price: quote.regularMarketPrice / 31.1034768,
                 name: 'Physical Gold 24K (Per Gram)',
                 yahooSymbol: 'XAUINR=X',
                 sector: 'Precious Metals',
                 source: 'Yahoo Finance (Calculated)'
               };
            }
          } catch(e) {
            console.error('Failed to fetch gold price', e);
          }
          return;
        }

        const lookupSym = MANUAL_MAP[sym] || sym;
        const isMF = lookupSym.startsWith('0P') || /^\d+$/.test(lookupSym) || lookupSym.startsWith('MF_') || lookupSym === 'GOLD-INR-GRAM';
        
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
                // Try to get name from Tickertape if available
                if (ttResults[sym]) {
                  fundName = ttResults[sym].name;
                }
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

            // Fallback to Tickertape if MFAPI failed
            if (!mfapiSuccess && ttResults[sym]) {
              const tt = ttResults[sym];
              mfPrices[sym] = {
                price: tt.price,
                name: tt.name,
                yahooSymbol: sym.startsWith('0P') ? sym : null,
                sector: null,
                source: tt.source || 'Tickertape'
              };
              mfapiSuccess = true;
            }

            // Fallback to Yahoo Finance if both failed
            if (!mfapiSuccess) {
              try {
                const result = await yahoo.quote(sym) as any;
                if (result && result.regularMarketPrice) {
                  mfPrices[sym] = {
                    price: result.regularMarketPrice,
                    name: result.shortName || result.longName || sym,
                    yahooSymbol: sym,
                    sector: null,
                    source: 'Yahoo Finance'
                  };
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
                
                const ySearch = await yahoo.search(cleanName, { quotesCount: 10 }) as any;
                const match = ySearch.quotes.find((q: any) => 
                  (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund') && 
                  (q.symbol.startsWith('0P') || q.symbol.includes('.BO') || q.symbol.includes('.NS'))
                );
                
                if (match) {
                  mfPrices[sym].yahooSymbol = match.symbol;
                } else {
                  const simplerName = cleanName.split(' ').slice(0, 3).join(' ');
                  const ySearch2 = await yahoo.search(simplerName, { quotesCount: 10 }) as any;
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

        // For non-MFs (Stocks), use Tickertape data if available
        if (ttResults[sym]) {
          const tt = ttResults[sym];
          stockMarketCaps[sym] = tt.marketCap;
          stockSectors[sym] = tt.sector;
          stockSources[sym] = tt.source || 'Tickertape';
          return;
        }

        // Fallback to Yahoo for Stocks
        try {
          const quote = await yahoo.quote(sym) as any;
          if (quote && quote.marketCap) {
            stockMarketCaps[sym] = quote.marketCap;
          }
          const summary = await yahoo.quoteSummary(sym, { modules: ['assetProfile'] }) as any;
          if (summary && summary.assetProfile && summary.assetProfile.sector) {
            stockSectors[sym] = summary.assetProfile.sector;
          }
          stockSources[sym] = 'Yahoo Finance';
        } catch (e: any) {
          // Silent fail for common errors
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
          const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || sym === 'GOLD-INR-GRAM';
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
          } else if (!isMF && stockSectors[sym]) {
            sector = stockSectors[sym] || sector;
          }

          // If we have Tickertape data, use it to override formulas for Refresh
          if (ttResults[sym]) {
            const tt = ttResults[sym];
            priceFormula = String(tt.price);
            nameFormula = tt.name;
            if (tt.sector) sector = tt.sector;
            source = tt.source || source;
          }

          if (!source && stockSources[sym]) {
            source = stockSources[sym];
          }

          let currencyFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "currency"), "INR")`;
          if (isMF || isIndian) currencyFormula = `INR`;
          else if (isUsdAsset) currencyFormula = `USD`;

          const typeFormula = sym === 'GOLD-INR-GRAM' ? `COMMODITY` : (isMF ? `MUTUALFUND` : `EQUITY`);
          if (sym === 'GOLD-INR-GRAM') sector = 'Precious Metals';
          
          const fallbackMarketCap = stockMarketCaps[sym] ? stockMarketCaps[sym] : '""';
          
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
          const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || sym === 'GOLD-INR-GRAM';
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
          } else if (!isMF && stockSectors[sym]) {
            sector = stockSectors[sym] || "";
            source = stockSources[sym] || "";
          }

          // If we have Tickertape data, use it
          if (ttResults[sym]) {
            const tt = ttResults[sym];
            priceFormula = String(tt.price);
            nameFormula = tt.name;
            if (tt.sector) sector = tt.sector;
            source = tt.source || source;
          }

          let currencyFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "currency"), "INR")`;
          if (isMF || isIndian) currencyFormula = `INR`;
          else if (isUsdAsset) currencyFormula = `USD`;

          const typeFormula = sym === 'GOLD-INR-GRAM' ? `COMMODITY` : (isMF ? `MUTUALFUND` : `EQUITY`);
          if (sym === 'GOLD-INR-GRAM') sector = 'Precious Metals';
          
          const fallbackMarketCap = stockMarketCaps[sym] ? stockMarketCaps[sym] : '""';
          
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
        const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || sym === 'GOLD-INR-GRAM';
        const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO') || sym === 'GOLD-INR-GRAM';
        
        let source = existingData[sym]?.source || "";
        if (isMF && mfPrices[sym]) {
          source = mfPrices[sym].source || source;
        } else if (!isMF && stockSources[sym]) {
          source = stockSources[sym] || source;
        }
        if (ttResults[sym]) {
          source = ttResults[sym].source || source;
        }

        if (!existingData[sym]) {
          existingData[sym] = {
            symbol: sym,
            regularMarketPrice: mfPrices[sym]?.price || null,
            shortName: mfPrices[sym]?.name || sym,
            currency: isMF ? 'INR' : (isIndian ? 'INR' : 'USD'),
            quoteType: sym === 'GOLD-INR-GRAM' ? 'COMMODITY' : (isMF ? 'MUTUALFUND' : 'EQUITY'),
            marketCap: null,
            yahooSymbol: mfPrices[sym]?.yahooSymbol || null,
            sector: sym === 'GOLD-INR-GRAM' ? 'Precious Metals' : (isMF ? null : (stockSectors[sym] || null)),
            source: source || null
          };
        } else {
          existingData[sym].source = source || existingData[sym].source;
          if (isIndian) {
            existingData[sym].currency = 'INR';
          }
          if (sym === 'GOLD-INR-GRAM') {
            existingData[sym].quoteType = 'COMMODITY';
            existingData[sym].sector = 'Precious Metals';
            if (mfPrices[sym]) {
              existingData[sym].regularMarketPrice = mfPrices[sym].price;
              existingData[sym].shortName = mfPrices[sym].name;
            }
          } else if (isMF) {
            existingData[sym].quoteType = 'MUTUALFUND';
            if (mfPrices[sym]) {
              existingData[sym].regularMarketPrice = mfPrices[sym].price;
              existingData[sym].shortName = mfPrices[sym].name;
              existingData[sym].yahooSymbol = mfPrices[sym].yahooSymbol || existingData[sym].yahooSymbol;
            }
          } else {
            existingData[sym].sector = stockSectors[sym] || existingData[sym].sector;
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
