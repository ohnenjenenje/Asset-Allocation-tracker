import { setDefaultResultOrder } from 'node:dns';
import { NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';
import YahooFinance from 'yahoo-finance2';
import { fetchFallbackQuote, fetchYahooChartQuote } from '@/lib/market/quotes';

// Prefer IPv4 for the remaining market-data hosts that publish AAAA records
// Render cannot route. Yahoo itself is rate-limited regardless of address
// family, which is why live quotes no longer depend on it.
setDefaultResultOrder('ipv4first');

const yahoo = new YahooFinance();

// A very short cache coalesces the stock/FX/futures lookups made by concurrent
// chunks without making a quote meaningfully stale. The quote's own
// `regularMarketTime` is returned separately as `asOf`.
const QUOTE_CACHE_TTL_MS = 30_000;
const quoteCache = new Map<string, { quote: any; fetchedAt: number }>();

// Yahoo returns HTTP 429 from Render. After two failures, stop trying for a
// while so one blocked host does not add latency to every symbol on the page.
const YAHOO_COOLDOWN_MS = 5 * 60_000;
let yahooBlockedUntil = 0;
let yahooFailures = 0;

const yahooAllowed = () => Date.now() >= yahooBlockedUntil;

const resetYahooFailures = () => {
  yahooFailures = 0;
  yahooBlockedUntil = 0;
};

const markYahooFailure = () => {
  yahooFailures += 1;
  if (yahooFailures >= 2 && Date.now() >= yahooBlockedUntil) {
    yahooBlockedUntil = Date.now() + YAHOO_COOLDOWN_MS;
    console.warn('Yahoo quotes unavailable; using provider fallbacks for 5 minutes.');
  }
};

const safeQuote = async (symbol: string) => {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.fetchedAt < QUOTE_CACHE_TTL_MS) {
    return cached.quote;
  }

  // Prefer providers that work from Render. Yahoo is only a last resort for
  // symbols the direct providers cannot resolve.
  let quote = await fetchFallbackQuote(symbol);

  if (!quote && yahooAllowed()) {
    quote = await fetchYahooChartQuote(symbol);
    if (quote) resetYahooFailures();
    else markYahooFailure();
  }

  if (quote) quoteCache.set(symbol, { quote, fetchedAt: Date.now() });
  return quote;
};

/** Yahoo returns `regularMarketTime` as a Date; normalise it to epoch ms. */
const quoteTimeMs = (quote: any): number | null => {
  const raw = quote?.regularMarketTime;
  if (!raw) return null;
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
};

/** MFAPI returns NAV dates as DD-MM-YYYY in India. */
const parseNavDate = (value?: string | null): number | null => {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(value ?? ''));
  if (!match) return null;
  const ms = new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00+05:30`).getTime();
  return Number.isFinite(ms) ? ms : null;
};

const safeQuoteSummary = async (symbol: string, options: any) => {
  if (!yahooAllowed()) return null;
  try {
    const result = await yahoo.quoteSummary(symbol, options);
    resetYahooFailures();
    return result;
  } catch (e) {
    markYahooFailure();
    console.error(`Error in Yahoo summary for ${symbol}:`, e);
    return null;
  }
};

const safeSearch = async (query: string, options: any) => {
  if (!yahooAllowed()) return { quotes: [] };
  try {
    const result = await yahoo.search(query, options);
    resetYahooFailures();
    return result;
  } catch (e) {
    markYahooFailure();
    console.error(`Error in Yahoo search for ${query}:`, e);
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


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');

    if (!symbolsParam) {
      return NextResponse.json({ error: 'Query parameter "symbols" is required' }, { status: 400 });
    }

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    // Reads are live by default. `sync=true` is the only mode that writes to
    // Google Sheets; `refresh=true` is kept as a backwards-compatible alias.
    const refresh = searchParams.get('refresh') === 'true';
    const sync = searchParams.get('sync') === 'true' || refresh;
    const live = searchParams.get('live') !== 'false' || refresh;
    
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
    const canUseSheet = Boolean(token && sheetId);

    if (!canUseSheet && (!live || sync)) {
      return NextResponse.json({
        error: 'Google Sheets credentials not configured. Please set GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID.',
      }, { status: 500 });
    }

    // 1. Read existing data. The sheet is only a metadata/fallback layer for
    // live reads, so a Sheets outage must not take the price API down.
    let responseData: any = { values: [] };

    if (canUseSheet) {
      const now = Date.now();
      try {
        if (cachedSheetData && (now - lastSheetFetch < CACHE_TTL) && !sync) {
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
      } catch (e: any) {
        if (!live) throw e;
        console.warn('Sheet read failed; continuing with live quotes only:', e?.message || e);
      }
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
      const isMarketCapMissing = !isGoldOrSilver && isNaN(d.marketCap);
      const isYahooSymbolMissing = isMF && !d.yahooSymbol;
      const isSectorMissing = !isMF && !d.sector;

      // Commodity prices are derived from USD/oz futures and the USD/INR rate,
      // so a stored sheet price goes stale as soon as either input moves.
      // Always recompute them for live reads; `live=false` keeps the cached
      // compatibility path used by clients that explicitly want sheet values.
      if (isGoldOrSilver) return live;

      // Mutual funds are static in the sheet, so we consider them 'broken' to force a regular fetch.
      return isMF || isPriceMissing || isMarketCapMissing || isYahooSymbolMissing || isSectorMissing;
    });
    
    let symbolsToUpdate = live
      ? [...new Set(symbols)]
      : [...new Set([...missingSymbols, ...brokenSymbols])];
    if (sync) {
      symbolsToUpdate = [...new Set([...symbolsToUpdate, ...symbols])];
    }

    console.log("Live mode:", live, "Sheet sync:", sync);
    console.log("Missing:", missingSymbols);
    console.log("Broken (price or market cap):", brokenSymbols);
    console.log("To Update:", symbolsToUpdate);

    // The quote's own timestamp and whether we had to fall back to the sheet.
    const quoteMeta: Record<string, { asOf: number | null; stale: boolean }> = {};

    // Tickertape Fetch array removed
    
    // 4. Append or update symbols
    if (symbolsToUpdate.length > 0) {
      const getGFinanceSymbol = (sym: string) => {
        if (sym === 'GOLD-INR-GRAM') return 'GC=F';
        if (sym === 'SILVER-INR-GRAM') return 'SI=F';
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
      const mfPrices: Record<string, { price: number | null, name: string | null, yahooSymbol: string | null, sector: string | null, source?: string, quoteType?: string, asOf?: number | null }> = {};
      const stockPrices: Record<string, any> = {};

      // Gold and silver are stored as INR per gram. Fetch the USD/INR rate once
      // per request so both metals use the same fresh conversion rate.
      const needsCommodityFx = symbolsToUpdate.some(
        (sym) => sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM',
      );
      const commodityFxQuote = needsCommodityFx
        ? (await safeQuote('INR=X') as any)
        : null;

      await Promise.all(symbolsToUpdate.map(async (sym) => {
        if (sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM') {
          // Keep a sheet price only as a fallback when the live quote fails.
          const sheetKeys = sym === 'GOLD-INR-GRAM' ? ['XAUINR'] : ['XAGINR'];
          let sheetPrice = null;
          for (const key of sheetKeys) {
            if (existingData[key] && existingData[key].regularMarketPrice) {
              sheetPrice = existingData[key].regularMarketPrice;
              break;
            }
          }

          try {
            // Gold API supplies spot USD/oz; Yahoo's GC=F/SI=F futures are the
            // fallback when spot is unavailable. Both are converted to INR per
            // gram below.
            const ySym = sym === 'GOLD-INR-GRAM' ? 'GC=F' : 'SI=F';
            const quote = await safeQuote(ySym) as any;
            const priceUsd = Number(quote?.regularMarketPrice);

            if (priceUsd > 0) {
              // 1 Troy Ounce = 31.1034768 grams
              const troyOunceInGrams = 31.1034768;

              const liveFx = Number(commodityFxQuote?.regularMarketPrice);
              const freshFx = liveFx > 0;
              const sheetFx = Number(existingData['INR=X']?.regularMarketPrice);
              // Never invent an FX rate: if every provider is unavailable, the
              // stored metal price is a safer fallback than a drifting constant.
              const usdToInr = freshFx ? liveFx : sheetFx > 0 ? sheetFx : null;

              if (usdToInr != null) {
                // Base conversion: (USD / Troy Ounce) -> (USD / Gram) -> (INR / Gram)
                let finalInrPrice = (priceUsd / troyOunceInGrams) * usdToInr;

                // Import Duty (15%: 10% BCD + 5% AIDC, effective May 2026) + GST (3%)
                const importDutyRate = 0.15;
                const gstRate = 0.03;
                finalInrPrice *= (1 + importDutyRate) * (1 + gstRate);

                const futuresTime = quoteTimeMs(quote);
                const fxTime = quoteTimeMs(commodityFxQuote);
                // Reference FX rates are daily, so allow for weekends and
                // holidays before calling them stale.
                const fxTooOld =
                  fxTime != null && Date.now() - fxTime > 96 * 60 * 60 * 1000;
                quoteMeta[sym] = {
                  asOf: futuresTime ?? fxTime ?? null,
                  stale: !freshFx || fxTooOld,
                };

                mfPrices[sym] = {
                  price: finalInrPrice,
                  name: sym === 'GOLD-INR-GRAM' ? 'Physical Gold 24K (Per Gram)' : 'Physical Silver (Per Gram)',
                  yahooSymbol: ySym,
                  sector: 'Precious Metals',
                  source: quote.source || 'Yahoo Finance',
                  asOf: quoteMeta[sym].asOf,
                };
              }
            }
          } catch(e) {
            console.error(`Failed to fetch ${sym} price`, e);
          }

          if (!mfPrices[sym] && sheetPrice) {
            quoteMeta[sym] = { asOf: null, stale: true };
            mfPrices[sym] = {
              price: sheetPrice,
              name: sym === 'GOLD-INR-GRAM' ? 'Physical Gold 24K (Per Gram)' : 'Physical Silver (Per Gram)',
              yahooSymbol: null,
              sector: 'Precious Metals',
              source: 'Google Sheet',
              asOf: null,
            };
          }
          if (!mfPrices[sym]) quoteMeta[sym] = { asOf: null, stale: true };
          return;
        }

        const lookupSym = MANUAL_MAP[sym] || sym;
        const isMF = lookupSym.startsWith('0P') || /^\d+$/.test(lookupSym) || lookupSym.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(lookupSym) || lookupSym === 'GOLD-INR-GRAM' || lookupSym === 'SILVER-INR-GRAM';
        
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
                    asOf: parseNavDate(data.data[0].date),
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
                          source: 'MFAPI',
                          asOf: parseNavDate(detailData.data[0].date),
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
                    source: 'Yahoo Finance',
                    asOf: quoteTimeMs(result)
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

          if (mfPrices[sym]) {
            quoteMeta[sym] = { asOf: mfPrices[sym].asOf ?? null, stale: false };
          } else {
            // The response will keep the sheet's stored NAV, which is cached.
            quoteMeta[sym] = { asOf: null, stale: true };
          }
          return;
        }

        // Bond ISINs are valued from the sheet; there is no public live quote.
        if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(sym)) {
          quoteMeta[sym] = { asOf: null, stale: true };
          return;
        }

        // For non-MFs (stocks, ETFs and crypto), use the live provider chain.
        quoteMeta[sym] = { asOf: null, stale: true };
        try {
          const fetchSym = MANUAL_MAP[sym] || sym;
          const quote = await safeQuote(fetchSym) as any;
          const hasPrice = Number(quote?.regularMarketPrice) > 0;

          if (hasPrice) {
            stockPrices[sym] = {
              symbol: sym,
              regularMarketPrice: quote.regularMarketPrice,
              currency: quote.currency || existingData[sym]?.currency || 'INR',
              shortName: quote.displayName || quote.shortName || existingData[sym]?.shortName || sym,
              marketCap: quote.marketCap ?? existingData[sym]?.marketCap ?? null,
              quoteType: quote.quoteType || existingData[sym]?.quoteType || 'EQUITY',
              sector: existingData[sym]?.sector || null,
              source: quote.source || 'Yahoo Finance',
              lastUpdated: Date.now()
            };
            quoteMeta[sym] = {
              asOf: quoteTimeMs(quote) ?? Date.now(),
              stale: false,
            };

            // Sector metadata is only available from Yahoo. Provider prices are
            // live without it, so do not delay the quote waiting for Yahoo.
            if (quote.source === 'Yahoo Finance' && yahooAllowed()) {
              try {
                const summary = await safeQuoteSummary(fetchSym, { modules: ['assetProfile'] }) as any;
                if (summary && summary.assetProfile && summary.assetProfile.sector) {
                  stockPrices[sym].sector = summary.assetProfile.sector;
                }
              } catch (e) {
                // Ignore sector fetch errors
              }
            }
          }
        } catch (e: any) {
          console.error(`Quote error for ${sym}:`, e?.message || e);
        }
      }));

      // If the sheet is completely empty, add headers first. Live reads never
      // mutate the sheet; only an explicit sync does.
      if (sync && rows.length === 0) {
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
      } else if (sync && rows[0].length < 9) {
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
          const isCommodity = sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM';
          const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(sym) || isCommodity;
          const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO') || isCommodity;
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

          const actualType = stockPrices[sym]?.quoteType || existingData[sym]?.quoteType || (isMF ? "MUTUALFUND" : "EQUITY");
          const typeFormula = isCommodity
            ? "COMMODITY"
            : actualType === "ETF"
              ? "ETF"
              : actualType === "CRYPTOCURRENCY"
                ? "CRYPTOCURRENCY"
                : (isMF ? "MUTUALFUND" : "EQUITY");
          if (isCommodity) sector = 'Precious Metals';
          
          const fallbackMarketCap = stockPrices[sym]?.marketCap ? stockPrices[sym].marketCap : '""';
          // Commodities are priced per gram in INR, so Google Finance has no
          // meaningful market cap for them.
          const marketCapFormula = isCommodity
            ? ''
            : `=IFNA(GOOGLEFINANCE("${gSym}", "marketcap"), ${fallbackMarketCap})`;
          
          // Skip updating the sheet if the symbol is a mutual fund and the value has not changed.
          // Commodities are always written so their type/sector metadata gets corrected.
          if (isMF && !isCommodity && existingData[sym] && existingData[sym].regularMarketPrice === parseFloat(priceFormula)) {
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
              marketCapFormula,
              yahooSymbol,
              sector,
              source
            ]]
          });
        }
      }

      if (sync && updateData.length > 0) {
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
      if (sync && missingSymbols.length > 0) {
        const appendData = missingSymbols.map(sym => {
          const gSym = getGFinanceSymbol(sym);
          const isCommodity = sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM';
          const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(sym) || isCommodity;
          const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO') || isCommodity;
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

          const actualType = stockPrices[sym]?.quoteType || existingData[sym]?.quoteType || (isMF ? "MUTUALFUND" : "EQUITY");
          const typeFormula = isCommodity
            ? "COMMODITY"
            : actualType === "ETF"
              ? "ETF"
              : actualType === "CRYPTOCURRENCY"
                ? "CRYPTOCURRENCY"
                : (isMF ? "MUTUALFUND" : "EQUITY");
          if (isCommodity) sector = 'Precious Metals';
          
          const fallbackMarketCap = stockPrices[sym]?.marketCap ? stockPrices[sym].marketCap : '""';
          const marketCapFormula = isCommodity
            ? ''
            : `=IFNA(GOOGLEFINANCE("${gSym}", "marketcap"), ${fallbackMarketCap})`;
          
          return [
            sym,
            priceFormula,
            nameFormula,
            currencyFormula,
            typeFormula,
            marketCapFormula,
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

      if (sync) {
        console.log(
          `Sheet sync complete: ${updateData.length} updated, ${missingSymbols.length} appended`,
        );
      }

      symbolsToUpdate.forEach(sym => {
        const isCommodity = sym === 'GOLD-INR-GRAM' || sym === 'SILVER-INR-GRAM';
        const isMF = sym.startsWith('0P') || /^\d+$/.test(sym) || sym.startsWith('MF_') || /^INF[A-Z0-9]{9}$/i.test(sym) || isCommodity;
        const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO') || isCommodity;
        
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
            source: source || null,
            asOf: quoteMeta[sym]?.asOf ?? null,
            stale: quoteMeta[sym]?.stale ?? false,
          };
        } else {
          existingData[sym].source = source || existingData[sym].source;
          if (quoteMeta[sym]) {
            existingData[sym].asOf = quoteMeta[sym].asOf;
            existingData[sym].stale = quoteMeta[sym].stale;
          }
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
            existingData[sym].quoteType =
              mfPrices[sym]?.quoteType ||
              (existingData[sym].quoteType === 'ETF' ? 'ETF' : 'MUTUALFUND');
            if (mfPrices[sym]) {
              existingData[sym].regularMarketPrice = mfPrices[sym].price;
              existingData[sym].shortName = mfPrices[sym].name;
              existingData[sym].yahooSymbol = mfPrices[sym].yahooSymbol || existingData[sym].yahooSymbol;
            }
          } else if (stockPrices[sym]) {
            existingData[sym].quoteType = stockPrices[sym].quoteType || existingData[sym].quoteType;
            existingData[sym].sector = stockPrices[sym].sector || existingData[sym].sector;
          }
        }
      });
    }

    // 4. Return requested symbols with the quote timestamp and fallback flag.
    const results = symbols
      .map((sym) => {
        const data = existingData[sym];
        if (!data) return null;
        const meta = quoteMeta[sym];
        return {
          ...data,
          asOf: meta ? meta.asOf : (typeof data.asOf === 'number' ? data.asOf : null),
          // Without quote metadata the value came from the sheet (or a stored
          // fallback), so `live=false` must still flag it as cached.
          stale: meta
            ? meta.stale
            : typeof data.stale === 'boolean'
              ? data.stale
              : !live,
          // Fetch time remains separate from the quote's own timestamp.
          lastUpdated: Date.now(),
        };
      })
      .filter(Boolean);
    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'no-store' },
    });

  } catch (error: any) {
    console.error('Price API fatal error:', error);
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      message: error.message || String(error) 
    }, { status: 500 });
  }
}
