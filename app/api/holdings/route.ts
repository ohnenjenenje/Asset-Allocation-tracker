import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';
import { GoogleAuth } from 'google-auth-library';

const yahoo = new YahooFinance();

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

export async function GET(request: Request) {
  let symbolForError = 'unknown';
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    if (symbol) symbolForError = symbol;

    if (!symbol) {
      return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
    }

    let targetSymbol = symbol;

    // If numeric, try to find mapping in sheet
    if (/^\d+$/.test(symbol)) {
      console.log(`Checking sheet for mapping of numeric symbol: ${symbol}`);
      const mapped = await getYahooSymbolFromSheet(symbol);
      if (mapped) {
        targetSymbol = mapped;
        console.log(`Found mapping in sheet: ${symbol} -> ${targetSymbol}`);
      } else {
        console.log(`No mapping found in sheet for ${symbol}. Attempting fallback search...`);
        // Try to search Yahoo Finance directly as a fallback
        try {
          // We need the name to search. Let's fetch it from mfapi.in
          const res = await fetch(`https://api.mfapi.in/mf/${symbol}`);
          if (res.ok) {
            const data = await res.json();
            const schemeName = data.meta.scheme_name;
            console.log(`Fetched scheme name from mfapi.in for ${symbol}: ${schemeName}`);
            
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
              targetSymbol = match.symbol;
              console.log(`Fallback mapping successful: ${symbol} (${schemeName}) -> ${targetSymbol}`);
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
                targetSymbol = match2.symbol;
                console.log(`Fallback mapping successful (simpler): ${symbol} -> ${targetSymbol}`);
              } else {
                console.warn(`Fallback mapping failed: No matching Yahoo symbol found for ${schemeName}`);
                return NextResponse.json({ holdings: [] });
              }
            }
          } else {
            console.error(`Failed to fetch scheme name from mfapi.in for ${symbol}: ${res.status}`);
            return NextResponse.json({ holdings: [] });
          }
        } catch (e) {
          console.error(`Fallback mapping error for ${symbol}:`, e);
          return NextResponse.json({ holdings: [] });
        }
      }
    }

    console.log(`Fetching holdings for target symbol: ${targetSymbol}`);
    const result = await yahoo.quoteSummary(targetSymbol, { modules: ['topHoldings', 'assetProfile'] });
    console.log(`Raw Yahoo Finance result for ${targetSymbol}:`, JSON.stringify(result, null, 2));
    
    const holdings = (result.topHoldings?.holdings || []) as any[];
    const sectorWeightings = (result.assetProfile?.sectorWeightings || []) as any[];
    
    console.log(`Fetched holdings for ${targetSymbol}:`, holdings.length, "items");
    console.log(`Fetched sector weightings for ${targetSymbol}:`, sectorWeightings.length, "items");
    
    return NextResponse.json({
      holdings,
      sectorWeightings,
      assetAllocation: {
        stockPosition: result.topHoldings?.stockPosition || 0,
        bondPosition: result.topHoldings?.bondPosition || 0,
        cashPosition: result.topHoldings?.cashPosition || 0,
        otherPosition: result.topHoldings?.otherPosition || 0,
        preferredPosition: result.topHoldings?.preferredPosition || 0,
        convertiblePosition: result.topHoldings?.convertiblePosition || 0,
      },
      categoryName: result.assetProfile?.categoryName || null,
      symbol: targetSymbol
    });
  } catch (error: any) {
    const isExpectedError = error.message?.includes('Quote not found') || 
                            error.message?.includes('429') || 
                            error.message?.includes('crumb');

    if (isExpectedError) {
      // Log as warning or skip logging for expected "not found" cases to reduce noise
      console.warn(`Holdings not available for ${symbolForError}: ${error.message}`);
      return NextResponse.json({ holdings: [], debug: error.message });
    }

    console.error(`Holdings API error for ${symbolForError}:`, error);
    return NextResponse.json({ 
      error: 'Internal Server Error',
      message: error.message || String(error),
      debug: error.message 
    }, { status: 500 });
  }
}
