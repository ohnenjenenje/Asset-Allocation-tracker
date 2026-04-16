import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';
import { GoogleAuth } from 'google-auth-library';

const yahoo = yahooFinance;

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

// Tickertape Holdings
async function getTickertapeHoldings(sid: string) {
  try {
    const url = `https://api.tickertape.in/mf/${sid}/portfolio`;
    console.log(`Fetching Tickertape holdings: ${url}`);
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Origin': 'https://www.tickertape.in',
        'Referer': 'https://www.tickertape.in/'
      }
    });
    if (!res.ok) {
      // Quietly return null to allow fallback to continue
      return null;
    }
    const data = await res.json();
    console.log(`Tickertape holdings response for ${sid}:`, JSON.stringify(data).substring(0, 200));
    const portfolio = data.data || {};
    
    if (!portfolio.holdings || portfolio.holdings.length === 0) {
      return null;
    }
    
    return {
      holdings: (portfolio.holdings || []).map((h: any) => ({
        symbol: h.ticker ? `${h.ticker}.NS` : h.sid, // Default to NSE for Indian stocks
        holdingName: h.name,
        holdingPercent: h.weight // Tickertape weights are usually 0-1
      })),
      sectorWeightings: (portfolio.sectorWeightings || []).map((s: any) => ({
        sector: s.sector,
        percentage: s.weight * 100
      })),
      assetAllocation: portfolio.assetAllocation ? {
        equity: portfolio.assetAllocation.equity * 100,
        debt: portfolio.assetAllocation.debt * 100,
        cash: portfolio.assetAllocation.cash * 100
      } : null,
      categoryName: portfolio.category || null,
      source: 'Tickertape'
    };
  } catch (e) {
    console.error('Tickertape holdings error:', e);
    return null;
  }
}

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
    let tickertapeData = null;

    // Manual mapping for known problematic Yahoo symbols to Tickertape SIDs
    const manualMappings: Record<string, string> = {
      '0P0001S0S9.BO': '0P0001RQX5.BO', // Legacy Zerodha Nifty LargeMidcap 250
      '0P0000XW0K.BO': '0P0000XV59.BO', // Legacy Edelweiss Liquid Fund
      '0P0011MAX.BO': 'MF_120503',  // Axis Small Cap Fund
      '120620': '0P0000XUY3.BO',    // ICICI Pru Nifty 50 Index Dir Gr
      'MF_120620': '0P0000XUY3.BO', // ICICI Pru Nifty 50 Index Dir Gr
      '101349': '0P00005UN0.BO',    // ICICI Pru Nifty 50 Index Reg Gr
      'MF_101349': '0P00005UN0.BO', // ICICI Pru Nifty 50 Index Reg Gr
      '135391': '0P00016NVL.BO',    // ICICI Pru Nifty 50 Index Dir IDCW-P
      'MF_135391': '0P00016NVL.BO', // ICICI Pru Nifty 50 Index Dir IDCW-P
      '135390': '0P00016QKW.BO',    // ICICI Pru Nifty 50 Index IDCW-P
      'MF_135390': '0P00016QKW.BO', // ICICI Pru Nifty 50 Index IDCW-P
      '152156': '0P0001RQX5.BO',    // Zerodha Nifty LargeMidcap 250 Index Fund
      'MF_152156': '0P0001RQX5.BO', // Zerodha Nifty LargeMidcap 250 Index Fund
      '152157': '0P0001RR1R.BO',    // Zerodha ELSS Tax Saver Nifty LargeMidcap 250 Index Fund
      'MF_152157': '0P0001RR1R.BO', // Zerodha ELSS Tax Saver Nifty LargeMidcap 250 Index Fund
      '140196': '0P0000XV59.BO',    // Edelweiss Liquid Fund - Direct Growth
      'MF_140196': '0P0000XV59.BO', // Edelweiss Liquid Fund - Direct Growth
      '140182': '0P0000AF06.BO',    // Edelweiss Liquid Fund - Regular Growth
      'MF_140182': '0P0000AF06.BO', // Edelweiss Liquid Fund - Regular Growth
      '149341': '0P0001NQZ6.BO',    // Edelweiss NIFTY Large Midcap 250 - Regular Growth
      'MF_149341': '0P0001NQZ6.BO', // Edelweiss NIFTY Large Midcap 250 - Regular Growth
      '149343': '0P0001NQZ6.BO',    // Edelweiss NIFTY Large Midcap 250 - Direct Growth
      'MF_149343': '0P0001NQZ6.BO', // Edelweiss NIFTY Large Midcap 250 - Direct Growth
    };

    let isMapped = false;
    let lookupSymbol = symbol;
    if (manualMappings[symbol]) {
      lookupSymbol = manualMappings[symbol];
      isMapped = true;
      console.log(`Manual mapping applied for holdings: ${symbol} -> ${lookupSymbol}`);
    }

    // 1. Try Tickertape first
    // If it looks like a SID (long string, no dots, not starting with 0P)
    const isLikelyTickertapeSid = lookupSymbol.length >= 8 && !lookupSymbol.includes('.') && !lookupSymbol.startsWith('0P');
    if (isLikelyTickertapeSid) {
      tickertapeData = await getTickertapeHoldings(lookupSymbol);
    }
    
    // If SID failed but we have a name, try searching by name
    // Skip name search for symbols we explicitly mapped to Yahoo Finance to avoid looping back to broken Tickertape SIDs
    const skipTickertapeNameSearch = ['0P0001BA2H.BO', '0P0000XUY3.BO', '0P00005UN0.BO', '0P00016NVL.BO', '0P00016QKW.BO', '0P0001RQX5.BO', '0P0001RR1R.BO', '0P0000XV59.BO', '0P0000AF06.BO', '0P0001NQZ6.BO'].includes(lookupSymbol);
    if (!skipTickertapeNameSearch && (!tickertapeData || tickertapeData.debug || tickertapeData.error) && name) {
      try {
        const ttSearchUrl = `https://api.tickertape.in/search/suggest?text=${encodeURIComponent(name)}&types=mf`;
        const ttRes = await fetch(ttSearchUrl, {
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Origin': 'https://www.tickertape.in',
            'Referer': 'https://www.tickertape.in/'
          }
        });
        
        if (ttRes.ok) {
          const ttData = await ttRes.json();
          const firstResult = ttData.data?.mfs?.[0] || ttData.data?.mf?.[0] || ttData.data?.[0];
          if (firstResult && firstResult.sid) {
            console.log(`Found alternative Tickertape SID via name search for "${name}": ${firstResult.sid} (${firstResult.name})`);
            if (firstResult.sid !== lookupSymbol) {
              const altData = await getTickertapeHoldings(firstResult.sid);
              if (altData && !altData.debug) {
                tickertapeData = altData;
              }
            }
          }
        }
      } catch (e) {
        // Quietly catch
      }
    }
    
    // If numeric (AMFI code), try Tickertape with MF_ prefix
    if (!tickertapeData && /^\d+$/.test(lookupSymbol)) {
      console.log(`Trying Tickertape with MF_ prefix for AMFI code: ${lookupSymbol}`);
      tickertapeData = await getTickertapeHoldings(`MF_${lookupSymbol}`);
    }

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
              
              // Try Tickertape search by name first
              console.log(`Searching Tickertape for: ${schemeName}`);
              const ttSearchUrl = `https://api.tickertape.in/search/suggest?text=${encodeURIComponent(schemeName)}&types=mf`;
              const ttRes = await fetch(ttSearchUrl, {
                headers: {
                  'Accept': 'application/json',
                  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Origin': 'https://www.tickertape.in',
                  'Referer': 'https://www.tickertape.in/'
                }
              });
              
              if (ttRes.ok) {
                const ttData = await ttRes.json();
                const firstResult = ttData.data?.mfs?.[0] || ttData.data?.mf?.[0] || ttData.data?.[0];
                if (firstResult && firstResult.sid) {
                  console.log(`Found Tickertape SID via search: ${firstResult.sid}`);
                  tickertapeData = await getTickertapeHoldings(firstResult.sid);
                }
              }

              if (!tickertapeData) {
                if (schemeName.toLowerCase().includes('zerodha nifty largemidcap 250')) {
                  tickertapeData = await getTickertapeHoldings('MF_151125');
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
          const result = await yahoo.quoteSummary(yfSymbol, { modules: ['topHoldings', 'assetProfile'] });
          
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
              equity: (result.topHoldings?.stockPosition || 0) * 100,
              debt: (result.topHoldings?.bondPosition || 0) * 100,
              cash: (result.topHoldings?.cashPosition || 0) * 100,
              other: (result.topHoldings?.otherPosition || 0) * 100,
            },
            categoryName: result.assetProfile?.categoryName || null,
            symbol: yfSymbol,
            source: 'Yahoo Finance'
          };
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
