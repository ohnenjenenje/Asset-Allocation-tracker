import { NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';
import yahooFinance from 'yahoo-finance2';

const yahoo = new yahooFinance();

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    if (!symbolsParam) {
      return NextResponse.json({ error: 'Query parameter "symbols" is required' }, { status: 400 });
    }

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    
    const token = await getAuthToken();
    const sheetId = process.env.GOOGLE_SHEET_ID;

    if (!token || !sheetId) {
      return NextResponse.json({ 
        error: 'Google Sheets credentials not configured. Please set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID.' 
      }, { status: 500 });
    }

    // 1. Read existing data
    const getRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:G?valueRenderOption=UNFORMATTED_VALUE`, {
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
        };
      }
    }

    // 2. Identify missing or broken symbols
    const missingSymbols = symbols.filter(s => !existingSymbols.has(s));
    const brokenSymbols = Object.values(existingData).filter(d => {
      const isMF = d.symbol.startsWith('0P') || /^\d+$/.test(d.symbol);
      const isPriceMissing = d.regularMarketPrice === null;
      const isMarketCapMissing = isNaN(d.marketCap);
      const isYahooSymbolMissing = isMF && !d.yahooSymbol;
      return isPriceMissing || isMarketCapMissing || isYahooSymbolMissing;
    }).map(d => d.symbol);
    const symbolsToUpdate = [...new Set([...missingSymbols, ...brokenSymbols])];

    console.log("Missing:", missingSymbols);
    console.log("Broken (price or market cap):", brokenSymbols);
    console.log("To Update:", symbolsToUpdate);

    // 3. Append or update symbols
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

      // Fetch prices for MFs if needed
      const mfPrices: Record<string, { price: number | null, name: string | null, yahooSymbol: string | null }> = {};
      for (const sym of symbolsToUpdate) {
        const isMF = sym.startsWith('0P') || /^\d+$/.test(sym);
        if (isMF) {
          try {
            if (/^\d+$/.test(sym)) {
              const res = await fetch(`https://api.mfapi.in/mf/${sym}`);
              if (res.ok) {
                const data = await res.json();
                if (data.data && data.data.length > 0) {
                  const schemeName = data.meta.scheme_name;
                  mfPrices[sym] = {
                    price: parseFloat(data.data[0].nav),
                    name: schemeName,
                    yahooSymbol: null
                  };

                  // Try to find Yahoo symbol mapping
                  try {
                    // Clean up the scheme name for better search results
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
                    
                    console.log(`Searching Yahoo for MF: ${cleanName} (original: ${schemeName})`);
                    const ySearch = await yahoo.search(cleanName, { quotesCount: 10 }) as any;
                    const match = ySearch.quotes.find((q: any) => 
                      (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund') && 
                      (q.symbol.startsWith('0P') || q.symbol.includes('.BO') || q.symbol.includes('.NS'))
                    );
                    
                    if (match) {
                      mfPrices[sym].yahooSymbol = match.symbol;
                      console.log(`Successfully mapped ${sym} (${schemeName}) to Yahoo symbol ${match.symbol}`);
                    } else {
                      // Try one more time with even simpler name
                      const simplerName = cleanName.split(' ').slice(0, 3).join(' ');
                      console.log(`Retrying Yahoo search with simpler name: ${simplerName}`);
                      const ySearch2 = await yahoo.search(simplerName, { quotesCount: 10 }) as any;
                      const match2 = ySearch2.quotes.find((q: any) => 
                        (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund') && 
                        (q.symbol.startsWith('0P') || q.symbol.includes('.BO') || q.symbol.includes('.NS'))
                      );
                      if (match2) {
                        mfPrices[sym].yahooSymbol = match2.symbol;
                        console.log(`Successfully mapped ${sym} (simpler) to Yahoo symbol ${match2.symbol}`);
                      } else {
                        console.warn(`No Yahoo symbol found for ${schemeName}`);
                      }
                    }
                  } catch (yErr) {
                    console.warn(`Yahoo search failed for ${schemeName}`, yErr);
                  }
                }
              }
            } else {
              const result = await yahoo.quote(sym) as any;
              if (result && result.regularMarketPrice) {
                mfPrices[sym] = {
                  price: result.regularMarketPrice,
                  name: result.shortName || result.longName || sym,
                  yahooSymbol: sym
                };
              }
            }
          } catch (e) {
            console.error(`Failed to fetch MF price for ${sym}`, e);
          }
        }
      }

      // If the sheet is completely empty, add headers first
      if (rows.length === 0) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:G1:append?valueInputOption=USER_ENTERED`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [['Symbol', 'Price', 'Name', 'Currency', 'Type', 'MarketCap', 'YahooSymbol']]
          })
        });
      } else if (rows[0].length < 7) {
        // Update headers if missing the 7th column
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:G1?valueInputOption=USER_ENTERED`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: [['Symbol', 'Price', 'Name', 'Currency', 'Type', 'MarketCap', 'YahooSymbol']]
          })
        });
      }

      // Update broken symbols in place using batchUpdate
      const updateData: any[] = [];
      for (const sym of brokenSymbols) {
        const rowIndex = rows.findIndex((r: any) => (typeof r[0] === 'string' ? r[0].toUpperCase() : r[0]) === sym);
        if (rowIndex >= 0) {
          const gSym = getGFinanceSymbol(sym);
          const rowNumber = rowIndex + 1;
          const isMF = sym.startsWith('0P') || /^\d+$/.test(sym);
          const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO');
          const isUsdAsset = sym.endsWith('-USD') || (!sym.includes('.') && !isMF);
          
          let priceFormula = gSym.startsWith('CURRENCY:') ? `=IFNA(GOOGLEFINANCE("${gSym}"), "")` : `=IFNA(GOOGLEFINANCE("${gSym}", "price"), "")`;
          let nameFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "name"), "${sym}")`;
          let yahooSymbol = existingData[sym]?.yahooSymbol || "";
          
          if (isMF && mfPrices[sym]) {
            priceFormula = String(mfPrices[sym].price);
            nameFormula = mfPrices[sym].name || sym;
            yahooSymbol = mfPrices[sym].yahooSymbol || yahooSymbol;
          }

          let currencyFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "currency"), "INR")`;
          if (isMF || isIndian) currencyFormula = `INR`;
          else if (isUsdAsset) currencyFormula = `USD`;

          const typeFormula = isMF ? `MUTUALFUND` : `EQUITY`;
          
          updateData.push({
            range: `A${rowNumber}:G${rowNumber}`,
            values: [[
              sym,
              priceFormula,
              nameFormula,
              currencyFormula,
              typeFormula,
              `=IFNA(GOOGLEFINANCE("${gSym}", "marketcap"), "")`,
              yahooSymbol
            ]]
          });
        }
      }

      if (updateData.length > 0) {
        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`, {
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
      }

      // Append missing symbols
      if (missingSymbols.length > 0) {
        const appendData = missingSymbols.map(sym => {
          const gSym = getGFinanceSymbol(sym);
          const isMF = sym.startsWith('0P') || /^\d+$/.test(sym);
          const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO');
          const isUsdAsset = sym.endsWith('-USD') || (!sym.includes('.') && !isMF);
          
          let priceFormula = gSym.startsWith('CURRENCY:') ? `=IFNA(GOOGLEFINANCE("${gSym}"), "")` : `=IFNA(GOOGLEFINANCE("${gSym}", "price"), "")`;
          let nameFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "name"), "${sym}")`;
          let yahooSymbol = "";
          
          if (isMF && mfPrices[sym]) {
            priceFormula = String(mfPrices[sym].price);
            nameFormula = mfPrices[sym].name || sym;
            yahooSymbol = mfPrices[sym].yahooSymbol || "";
          }

          let currencyFormula = `=IFNA(GOOGLEFINANCE("${gSym}", "currency"), "INR")`;
          if (isMF || isIndian) currencyFormula = `INR`;
          else if (isUsdAsset) currencyFormula = `USD`;

          const typeFormula = isMF ? `MUTUALFUND` : `EQUITY`;
          
          return [
            sym,
            priceFormula,
            nameFormula,
            currencyFormula,
            typeFormula,
            `=IFNA(GOOGLEFINANCE("${gSym}", "marketcap"), "")`,
            yahooSymbol
          ];
        });

        await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:G:append?valueInputOption=USER_ENTERED`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            values: appendData
          })
        });
      }

      symbolsToUpdate.forEach(sym => {
        const isMF = sym.startsWith('0P') || /^\d+$/.test(sym);
        if (!existingData[sym]) {
          existingData[sym] = {
            symbol: sym,
            regularMarketPrice: mfPrices[sym]?.price || null,
            shortName: mfPrices[sym]?.name || sym,
            currency: isMF ? 'INR' : (sym.endsWith('.NS') || sym.endsWith('.BO') ? 'INR' : 'USD'),
            quoteType: isMF ? 'MUTUALFUND' : 'EQUITY',
            marketCap: null,
            yahooSymbol: mfPrices[sym]?.yahooSymbol || null,
          };
        } else {
          if (isMF || sym.endsWith('.NS') || sym.endsWith('.BO')) {
            existingData[sym].currency = 'INR';
            if (isMF) {
              existingData[sym].quoteType = 'MUTUALFUND';
              if (mfPrices[sym]) {
                existingData[sym].regularMarketPrice = mfPrices[sym].price;
                existingData[sym].shortName = mfPrices[sym].name;
                existingData[sym].yahooSymbol = mfPrices[sym].yahooSymbol || existingData[sym].yahooSymbol;
              }
            }
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
