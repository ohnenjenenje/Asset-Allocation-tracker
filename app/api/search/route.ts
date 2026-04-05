import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

const yahoo = new yahooFinance();

// Configuration for API endpoints
const STOCK_APIS = (process.env.INDIAN_API_ENDPOINTS || 'https://stock.indianapi.in/search').split(',').map(s => {
  let url = s.trim();
  if (url === 'https://stock.indianapi.in' || url === 'https://stock.indianapi.in/') {
    return 'https://stock.indianapi.in/search';
  }
  return url;
});

// New API source
const NEW_STOCK_APIS = ['https://military-jobye-haiqstudios-14f59639.koyeb.app/search'];

const STOCK_KEYS = (process.env.INDIAN_API_KEYS || '').split(',').map(s => s.trim());

const MF_APIS = (process.env.MF_API_ENDPOINTS || 'https://api.mfapi.in/mf/search').split(',').map(s => {
  let url = s.trim();
  if (url === 'https://api.mfapi.in' || url === 'https://api.mfapi.in/') {
    return 'https://api.mfapi.in/mf/search';
  }
  return url;
});

async function fetchWithFailover(endpoints: string[], query: string, transformFn: (data: any) => any[], keys: string[] = [], paramName: string = 'q') {
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const apiKey = keys[i];
    
    // indianapi.in requires an API key. If it's missing, skip to avoid 400 errors.
    if (endpoint.includes('indianapi.in') && !apiKey) {
      continue;
    }

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      let url = `${endpoint}?${paramName}=${encodeURIComponent(query)}`;
      if (apiKey) {
        if (endpoint.includes('indianapi.in')) {
          headers['X-API-Key'] = apiKey;
          url += `&api_key=${apiKey}`;
        } else {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
      }
      
      const res = await fetch(url, { headers });
      
      if (!res.ok) {
        const errorBody = await res.text();
        console.error(`API Error from ${endpoint}: Status ${res.status}, Body: ${errorBody}`);
        continue;
      }

      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        console.error(`Invalid Content-Type from ${endpoint}: ${contentType}`);
        continue;
      }

      const data = await res.json();
      return transformFn(data);
    } catch (e) {
      console.error(`Error fetching from ${endpoint}:`, e);
    }
  }
  return [];
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const source = searchParams.get('source'); // New source parameter

  if (!q) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  try {
    // 1. Search Mutual Funds
    const mfQuotes = await fetchWithFailover(MF_APIS, q, (data) => {
      console.log('MFAPI response:', data);
      if (Array.isArray(data)) {
        return data.map(mf => ({
          symbol: mf.schemeCode,
          shortname: mf.schemeName,
          longname: mf.schemeName,
          quoteType: 'MUTUALFUND'
        }));
      }
      return [];
    }, [], 'q');

    // 2. Search Stocks
    let stockQuotes: any[] = [];
    
    // Select API based on source
    if (source === 'indianapi') {
      stockQuotes = await fetchWithFailover(STOCK_APIS, q, (data) => {
        console.log('IndianAPI response:', data);
        const results = Array.isArray(data) ? data : (data.results || data.data || []);
        if (Array.isArray(results)) {
          return results.map(s => ({
            symbol: s.symbol || s.ticker,
            shortname: s.shortname || s.name,
            longname: s.longname || s.name,
            quoteType: 'EQUITY'
          }));
        }
        return [];
      }, STOCK_KEYS, 'query');
    } else if (source === 'newapi') {
      stockQuotes = await fetchWithFailover(NEW_STOCK_APIS, q, (data) => {
        console.log('NewAPI response:', data);
        const results = Array.isArray(data) ? data : (data.results || data.data || []);
        if (Array.isArray(results)) {
          return results.map(s => ({
            symbol: s.symbol || s.ticker,
            shortname: s.shortname || s.name,
            longname: s.longname || s.name,
            quoteType: 'EQUITY'
          }));
        }
        return [];
      }, STOCK_KEYS, 'query');
    }

    // 3. Search Yahoo Finance as a final fallback for stocks if primary APIs returned nothing
    // OR if Yahoo is explicitly selected
    if (stockQuotes.length === 0 || source === 'yahoo') {
      try {
        // If the query doesn't explicitly mention NSE, BSE, .NS, or .BO, bias towards NSE
        const isIndian = q.toLowerCase().includes('nse') || 
                         q.toLowerCase().includes('bse') || 
                         q.toLowerCase().includes('.ns') || 
                         q.toLowerCase().includes('.bo');
        
        // Check if it looks like a crypto or US stock
        const isCryptoOrUS = q.includes('-') || /^[A-Z]{1,5}$/.test(q.toUpperCase());
        
        const searchQ = (isIndian || isCryptoOrUS) ? q : `${q} NSE`;
        
        console.log('Searching Yahoo Finance for:', searchQ);
        const yahooResult = await yahoo.search(searchQ, { quotesCount: 6, newsCount: 0 });
        console.log('Yahoo Finance response:', yahooResult);
        stockQuotes = (yahooResult.quotes || []).map(q => ({
          symbol: q.symbol,
          shortname: q.shortname,
          longname: q.longname,
          quoteType: q.quoteType
        }));
      } catch (e) {
        console.error('Yahoo Finance search error:', e);
      }
    }

    // 4. Combine and return
    let combined = [...mfQuotes, ...stockQuotes];
    
    // Manual mapping for specific queries
    if (q.toLowerCase().includes('axis small cap fund dir')) {
      combined.unshift({
        symbol: '0P0011MAX.BO',
        shortname: 'Axis Small Cap Fund Direct-Growth',
        longname: 'Axis Small Cap Fund Direct-Growth',
        quoteType: 'MUTUALFUND'
      });
    }

    combined = combined.slice(0, 10);
    return NextResponse.json(combined);
  } catch (error: any) {
    console.error('Search API error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch data' }, { status: 500 });
  }
}
