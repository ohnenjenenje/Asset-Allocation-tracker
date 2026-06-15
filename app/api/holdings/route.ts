import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { GoogleAuth } from 'google-auth-library';

const yahoo = new YahooFinance();

const safeQuote = async (symbol: string) => {
  try {
    return await yahoo.quote(symbol);
  } catch (e) {
    console.error(`Error in yahoo.quote for ${symbol}:`, e);
    return null;
  }
};

const safeQuoteSummary = async (symbol: string, options: any) => {
  try {
    return await yahoo.quoteSummary(symbol, options);
  } catch (e) {
    console.error(`Error in yahoo.quoteSummary for ${symbol}:`, e);
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

async function getYahooSymbolFromSheet(symbol: string) {
  const token = await getAuthToken();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!token || !sheetId) return null;

  try {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A:G?valueRenderOption=UNFORMATTED_VALUE`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rows = data.values || [];
    const row = rows.find((r: any) => (typeof r[0] === 'string' ? r[0].toUpperCase() : String(r[0])) === symbol.toUpperCase());
    return row && row[6] ? row[6] : null;
  } catch (e) {
    console.error("Failed to read mapping from sheet", e);
    return null;
  }
}

// Tickertape holdings removed.

export async function GET(request: Request) {
  let symbolForError = 'unknown';
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const name = searchParams.get('name');
    if (symbol) symbolForError = symbol;

    if (!symbol) {
      return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
    }

    let targetSymbol = symbol;
    let tickertapeData: any = null; // Left for compatibility flow, but it won't be filled by TT.

    // Manual mapping for Yahoo symbols that are actually mutual funds
    const MANUAL_MAP: Record<string, string> = {
      '0P0001S0S9.BO': '152156', // Zerodha Nifty LargeMidcap 250
      '0P0000XW0K.BO': '140196', // Edelweiss Liquid Fund - Direct Growth
      '0P0011MAX.BO': '120503',  // Axis Small Cap Fund
      '0P0000XV5G.BO': '140243', // Edelweiss Greater China - Direct
      '0P0000KYO9.BO': '140242', // Edelweiss Greater China - Regular
      'NIFTYBEES.NS': '140084',  // Nippon India ETF Nifty 50 BeES
      'NIFTYBEES.BO': '140084',
      'ALPHA.NS': '149397',      // Kotak Nifty Alpha 50 ETF (Yahoo symbol)
      'ALPHA.BO': '149397',
      'ALPHAETF.NS': '149397',   // Alternative mapping
      'ALPHAETF.BO': '149397',
      'KOTAKNIFTY.NS': '112351', // Kotak Nifty 50 ETF
      'KOTAKNIFTY.BO': '112351',
    };
    const resolvedSymbol = MANUAL_MAP[symbol.toUpperCase()] || symbol;

    // --- UPVALY FINAPI INTEGRATION (Primary Fetch) ---
    const isMutualFund = resolvedSymbol.startsWith('MF_') || /^\d{5,6}$/.test(resolvedSymbol);
    const schemeCode = resolvedSymbol.replace('MF_', '');

    if (isMutualFund) {
      console.log(`[HOLDINGS API] Attempting Upvaly fetch for ${resolvedSymbol} (schemeCode: ${schemeCode})`);
      try {
        const upvalyRes = await fetch(`https://finapi.upvaly.com/api/mf/scheme-code/${schemeCode}?_t=${Date.now()}`, {
          cache: 'no-store'
        });
        
        console.log(`[HOLDINGS API] Upvaly res.ok: ${upvalyRes.ok}, status: ${upvalyRes.status}`);
        if (upvalyRes.ok) {
          const upvalyData = await upvalyRes.json();
          console.log(`[HOLDINGS API] Upvaly data status: ${upvalyData.status}, has data: ${!!upvalyData.data}`);
          if (upvalyData.status === 'success' && upvalyData.data) {
            const d = upvalyData.data;
            
            // Map to existing frontend format and return immediately
            return NextResponse.json({
              source: 'Upvaly FinAPI',
              symbol: symbol,
              categoryName: d.schemeCategory || null,
              debugKeys: d.portfolio ? Object.keys(d.portfolio) : [],
              debugMC: d.portfolio?.marketCapWeightage || 'MISSING',
              assetAllocation: {
                stockPosition: parseFloat(d.portfolio?.assetAllocation?.equityAllocation || "0"),
                bondPosition: parseFloat(d.portfolio?.assetAllocation?.debtAllocation || "0"),
                cashPosition: parseFloat(d.portfolio?.assetAllocation?.cashAllocation || "0"),
                otherPosition: parseFloat(d.portfolio?.assetAllocation?.otherAllocation || "0")
              },
              marketCapWeightage: (() => {
                const mc = d.portfolio?.marketCapWeightage;
                if (!mc) return null;
                const large = parseFloat(mc.largeCap || "0");
                const mid = parseFloat(mc.midCap || "0");
                const small = parseFloat(mc.smallCap || "0");
                const others = parseFloat(mc.others || "0");
                return (large + mid + small + others) > 0 ? { largeCap: large, midCap: mid, smallCap: small, others } : null;
              })(),
              sectorWeightings: (d.sectors || []).map((s: any) => ({
                sector: s.sector,
                percentage: parseFloat(s.weightage)
              })),
              holdings: (d.holdings || []).map((h: any) => ({
                symbol: h.name, 
                holdingName: h.name,
                holdingPercent: parseFloat(h.weightage) / 100
              }))
            });
          }
        }
      } catch (e: any) {
        console.error(`Upvaly fetch failed for ${schemeCode}:`, e.message || e);
        // Let it fall through to Yahoo Finance fallback below
      }
    }
    // --- END UPVALY INTEGRATION ---


    let isMapped = false;
    let lookupSymbol = symbol;

    // 1. Tickertape logic removed

    if (!tickertapeData && !isMapped) {
      // If numeric, try to find mapping in sheet
      if (/^\d+$/.test(symbol)) {
        console.log(`Checking sheet for mapping of numeric symbol: ${symbol}`);
        const mapped = await getYahooSymbolFromSheet(symbol);
        if (mapped) {
          targetSymbol = mapped;
          console.log(`Found mapping in sheet: ${symbol} -> ${targetSymbol}`);
        } else {
          console.log(`No mapping found in sheet for ${symbol}. Attempting fallback search...`);
          try {
            const res = await fetch(`https://api.mfapi.in/mf/${symbol}`);
            if (res.ok) {
              const data = await res.json();
              const schemeName = data.meta.scheme_name;
              
              // Removed Tickertape search by name
              
              if (!tickertapeData) {
                if (schemeName.toLowerCase().includes('zerodha nifty largemidcap 250')) {
                  // Removed
                } else {
                  const cleanName = schemeName.replace(/Direct Plan|Regular Plan|Direct|Regular|Growth|IDCW|Dividend|Option|Plan|Scheme|Index Fund|Fund|Index/gi, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
                  const ySearch = await yahoo.search(cleanName, { quotesCount: 5 }) as any;
                  const match = ySearch.quotes.find((q: any) => (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund'));
                  if (match) targetSymbol = match.symbol;
                }
              }
            }
          } catch (e) {
            console.error(`Fallback mapping error for ${symbol}:`, e);
          }
        }
      }
    }

    // 2. Fallback to Yahoo Finance if Tickertape failed
    // Ensure we don't call Yahoo for symbols we know will fail
    const knownFailingSymbols = ['0P0001S0S9.BO', '0P0000XW0K.BO', '0P0011MAX.BO'];
    if (!tickertapeData && !knownFailingSymbols.includes(lookupSymbol)) {
      try {
        let yfSymbol = lookupSymbol;
        
        // If the symbol is a Tickertape SID (MF_), we can't use it directly in Yahoo Finance.
        // Try to find the Yahoo symbol by searching the name.
        if (yfSymbol.startsWith('MF_') && name) {
          console.log(`Target symbol is a Tickertape SID (${yfSymbol}), searching Yahoo Finance by name: ${name}`);
          const cleanName = name.replace(/Direct Plan|Retail Plan|Regular Plan|Direct|Regular|Growth|IDCW|Dividend|Option|Plan|Scheme|Index Fund|Fund|Index/gi, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
          const ySearch = await yahoo.search(cleanName, { quotesCount: 5 }) as any;
          const match = ySearch.quotes.find((q: any) => (q.quoteType === 'MUTUALFUND' || q.typeDisp === 'Mutual Fund'));
          if (match) {
            yfSymbol = match.symbol;
            console.log(`Found Yahoo symbol via name search: ${yfSymbol}`);
          } else {
            console.log(`Could not find Yahoo symbol for name: ${cleanName}`);
          }
        }

        if (!yfSymbol.startsWith('MF_')) {
          console.log(`Fetching holdings for target symbol: ${yfSymbol}`);
          const result = await safeQuoteSummary(yfSymbol, { modules: ['topHoldings', 'assetProfile'] });
          
          if (result) {
            tickertapeData = {
              holdings: (result.topHoldings?.holdings || []).map((h: any) => ({
                symbol: h.symbol,
                holdingName: h.holdingName,
                holdingPercent: h.holdingPercent
              })),
              sectorWeightings: ((result.assetProfile as any)?.sectorWeightings || []).map((s: any) => ({
                sector: s.sector,
                percentage: s.percentage * 100
              })),
              assetAllocation: {
                stockPosition: (result.topHoldings?.stockPosition || 0) * 100,
                bondPosition: (result.topHoldings?.bondPosition || 0) * 100,
                cashPosition: (result.topHoldings?.cashPosition || 0) * 100,
                otherPosition: (result.topHoldings?.otherPosition || 0) * 100,
              },
              categoryName: result.assetProfile?.categoryName || null,
              symbol: yfSymbol,
              source: 'Yahoo Finance'
            };
          }
        } else {
           console.log(`Skipping Yahoo Finance fetch because symbol is still a Tickertape SID: ${yfSymbol}`);
        }
      } catch (e: any) {
        console.error(`Yahoo Finance fetch failed for ${targetSymbol}`, e);
      }
    }

    if (tickertapeData) {
      return NextResponse.json(tickertapeData);
    }

    return NextResponse.json({ 
      holdings: [], 
      debug: 'No holdings found' 
    });
  } catch (error: any) {
    console.error(`Holdings API error for ${symbolForError}:`, error);
    return NextResponse.json({ error: 'Internal Server Error', message: error.message }, { status: 500 });
  }
}
