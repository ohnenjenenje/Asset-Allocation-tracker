import { NextResponse } from 'next/server';
import { recordIndianApiRequest } from '@/lib/indianapi-usage';
import { yahooSearch } from '@/lib/market/yahoo';

// Configuration for API endpoints
const STOCK_APIS = (process.env.INDIAN_API_ENDPOINTS || 'https://stock.indianapi.in/search').split(',').map(s => {
  let url = s.trim();
  if (url === 'https://stock.indianapi.in' || url === 'https://stock.indianapi.in/') {
    return 'https://stock.indianapi.in/search';
  }
  return url;
});

const STOCK_KEYS = (process.env.INDIAN_API_KEYS || '').split(',').map(s => s.trim());

const MF_APIS = (process.env.MF_API_ENDPOINTS || 'https://api.mfapi.in/mf/search').split(',').map(s => {
  let url = s.trim();
  if (url === 'https://api.mfapi.in' || url === 'https://api.mfapi.in/') {
    return 'https://api.mfapi.in/mf/search';
  }
  return url;
});

// Global cache for the full list of mutual funds (approx 37k items, ~5MB)
let cachedMfList: any[] = [];
let cachedMfIndex: Array<{
  schemeCode: string;
  schemeName: string;
  name: string;
  nameNoSpaces: string;
}> = [];
let mfListLastFetched = 0;

function buildMfIndex(list: any[]) {
  return list
    .filter((mf: any) => mf?.schemeCode != null && typeof mf?.schemeName === 'string')
    .map((mf: any) => {
      const name = mf.schemeName.toLowerCase();
      return {
        schemeCode: String(mf.schemeCode),
        schemeName: mf.schemeName,
        name,
        nameNoSpaces: name.replace(/\s+/g, ''),
      };
    });
}

async function getFullMfList() {
  const now = Date.now();
  if (cachedMfIndex.length === 0 && cachedMfList.length > 0) {
    cachedMfIndex = buildMfIndex(cachedMfList);
  }
  // Cache for 24 hours. The index is built once so each search only has to
  // score pre-normalized names instead of lowercasing 37k schemes again.
  if (cachedMfList.length > 0 && (now - mfListLastFetched < 24 * 60 * 60 * 1000)) {
    return cachedMfList;
  }
  try {
    const res = await fetch('https://api.mfapi.in/mf');
    if (res.ok) {
      cachedMfList = await res.json();
      cachedMfIndex = buildMfIndex(cachedMfList);
      mfListLastFetched = now;
    }
  } catch (error) {
    console.error('Failed to fetch full MF list:', error);
  }
  return cachedMfList;
}

async function fetchWithFailover(endpoints: string[], query: string, transformFn: (data: any) => any[], keys: string[] = [], paramName: string = 'q') {
  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const apiKey = keys[i];
    const isIndianApi = endpoint.includes('indianapi.in');
    
    // indianapi.in requires an API key. If it's missing, skip to avoid 400 errors.
    if (isIndianApi && !apiKey) {
      continue;
    }

    try {
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      const url = `${endpoint}?${paramName}=${encodeURIComponent(query)}`;
      if (apiKey) {
        if (isIndianApi) {
          // Header only: IndianAPI ignores api_key in the query string and
          // putting it in the URL risks leaking it into proxy/access logs.
          headers['X-API-Key'] = apiKey;
        } else {
          headers['Authorization'] = `Bearer ${apiKey}`;
        }
      }
      
      const res = await fetch(url, { headers });
      if (isIndianApi) {
        // Fire-and-forget; never delay or fail a search because of usage
        // tracking. Counts every attempt, including 429s.
        void recordIndianApiRequest(res.status);
      }
      
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

const SEARCH_HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 4000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keyless Indian-equity fallback. Tickertape returns NSE tickers, so append
 * .NS to keep the selected asset compatible with the Yahoo price route.
 */
async function searchTickertape(query: string): Promise<any[]> {
  const url = `https://api.tickertape.in/search?text=${encodeURIComponent(query)}`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        ...SEARCH_HEADERS,
        Origin: 'https://www.tickertape.in',
        Referer: 'https://www.tickertape.in/',
      },
    });
    if (!res.ok) {
      console.error(`Tickertape search failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const stocks = Array.isArray(data?.data?.stocks) ? data.data.stocks : [];
    return stocks
      .filter((stock: any) => typeof stock?.ticker === 'string' && stock.ticker.trim())
      .map((stock: any) => ({
        symbol: `${stock.ticker.trim().toUpperCase()}.NS`,
        shortname: stock.name,
        longname: stock.name,
        quoteType: stock.type === 'etf' ? 'ETF' : 'EQUITY',
        source: 'Tickertape',
      }));
  } catch (e: any) {
    console.error('Tickertape search error:', e.message || e);
    return [];
  }
}

/**
 * Last-resort Indian-equity fallback. Moneycontrol's suggestion payload embeds
 * the NSE ticker in the second field of its <span> (ISIN, TICKER, CODE).
 */
async function searchMoneycontrol(query: string): Promise<any[]> {
  const url = `https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&query=${encodeURIComponent(
    query,
  )}&type=1&format=json`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: { ...SEARCH_HEADERS, Referer: 'https://www.moneycontrol.com/' },
    });
    if (!res.ok) {
      console.error(`Moneycontrol search failed: ${res.status}`);
      return [];
    }

    const data = await res.json();
    const rows = Array.isArray(data) ? data : [];
    const quotes: any[] = [];

    for (const row of rows) {
      const span = String(row?.pdt_dis_nm || '').match(/<span>([^<]+)<\/span>/i);
      const parts = span?.[1]?.split(',').map((part) => part.trim()) ?? [];
      const ticker = parts[1]?.toUpperCase();
      const name = row?.name || row?.stock_name;
      if (!ticker || !name) continue;

      quotes.push({
        symbol: `${ticker}.NS`,
        shortname: name,
        longname: name,
        quoteType: 'EQUITY',
        source: 'Moneycontrol',
      });
    }

    return quotes;
  } catch (e: any) {
    console.error('Moneycontrol search error:', e.message || e);
    return [];
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const source = searchParams.get('source'); // New source parameter

  if (!q) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  try {
    console.log(`Search request: q=${q}, source=${source}`);
    // "tickertape" is the legacy value for the automatic source. "newapi"
    // pointed at a dead Koyeb deployment, so treat it as automatic too.
    const effectiveSource =
      !source || source === 'tickertape' || source === 'newapi' ? 'default' : source;
    // 1. Check if query is an ISIN (12 characters, starts with IN)
    const isIsin = /^IN[A-Z0-9]{10}$/i.test(q);
    let isinQuotes: any[] = [];
    
    if (isIsin) {
      try {
        const isinUpper = q.toUpperCase();
        const figiRes = await fetch('https://api.openfigi.com/v3/mapping', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([{ idType: 'ID_ISIN', idValue: isinUpper }])
        });
        
        if (figiRes.ok) {
          const figiData = await figiRes.json();
          if (figiData && figiData[0] && figiData[0].data && figiData[0].data.length > 0) {
            const match = figiData[0].data[0];
            const typeStr = (match.securityType || '').toUpperCase();
            const isDebt = typeStr.includes('CORP') || typeStr.includes('BOND') || typeStr.includes('DEBT');
            
            isinQuotes.push({
              symbol: isinUpper,
              shortname: match.name || match.securityDescription || isinUpper,
              longname: match.securityDescription || match.name || isinUpper,
              quoteType: isDebt ? 'DEBT' : 'FIXED INCOME'
            });
          }
        }
      } catch (e) {
        console.error('OpenFIGI ISIN search error:', e);
      }
      
      // If ISIN not found in OpenFIGI, provide a generic fallback
      if (isinQuotes.length === 0) {
        isinQuotes.push({
          symbol: q.toUpperCase(),
          shortname: `Unknown ISIN (${q.toUpperCase()})`,
          longname: `Unknown ISIN (${q.toUpperCase()})`,
          quoteType: 'FIXED INCOME'
        });
      }
    }

    // 1. Search Mutual Funds (mfapi.in as primary for MFs)
    let mfQuotes: any[] = [];
    if (effectiveSource !== 'yahoo' && effectiveSource !== 'indianapi') {
      // Smart MF Search Logic using cached full list
      const allMfs = await getFullMfList();
      
      if (allMfs && allMfs.length > 0) {
        const qLower = q.toLowerCase();
        const words = qLower.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
        const qNoSpaces = qLower.replace(/\s+/g, '');
        
        const scored = cachedMfIndex.map((mf) => {
          const name = mf.name;
          const nameNoSpaces = mf.nameNoSpaces;
          let score = 0;
          let allMatched = true;
          
          for (const w of words) {
            if (name.includes(w) || nameNoSpaces.includes(w)) {
              score += 10;
            } else {
              // Handle common aliases and abbreviations
              if (w === 'growth' && (name.includes(' gr') || name.includes('cumulative'))) score += 10;
              else if (w === 'regular' && (name.includes(' reg') || (!name.includes('direct') && !name.includes(' dir')))) score += 10;
              else if (w === 'direct' && name.includes(' dir')) score += 10;
              else if ((w === 'idcw' || w === 'dividend') && (name.includes(' div') || name.includes('payout') || name.includes('reinvestment'))) score += 10;
              else if (w === 'fund' || w === 'plan' || w === 'option' || w === 'mf') {
                // Ignore these generic words if missing
              } else {
                score -= 5;
                allMatched = false;
              }
            }
          }
          
          // Bonus for exact phrase match
          if (name.includes(qLower) || (qNoSpaces.length > 4 && nameNoSpaces.includes(qNoSpaces))) score += 50;
          
          return { ...mf, score, allMatched };
        });

        let bestMatches = scored.filter((s: any) => s.score > 0).sort((a: any, b: any) => b.score - a.score);
        
        // If we have perfect matches (all words matched), prefer those
        const perfectMatches = bestMatches.filter((s: any) => s.allMatched);
        if (perfectMatches.length > 0) {
          bestMatches = perfectMatches;
        }

        mfQuotes = bestMatches.slice(0, 5).map((mf: any) => ({
          symbol: `MF_${mf.schemeCode}`,
          shortname: mf.schemeName,
          longname: mf.schemeName,
          quoteType: mf.schemeName?.toUpperCase().includes("ETF") ? "ETF" : "MUTUALFUND",
          source: 'MFAPI'
        }));
      } else {
        // Fallback to direct API call if cache fails
        mfQuotes = await fetchWithFailover(MF_APIS, q, (data) => {
          const results = Array.isArray(data) ? data : [];
          return results.map((mf: any) => ({
            symbol: `MF_${mf.schemeCode}`,
            shortname: mf.schemeName,
            longname: mf.schemeName,
            quoteType: mf.schemeName?.toUpperCase().includes("ETF") ? "ETF" : "MUTUALFUND",
            source: 'MFAPI'
          }));
        }, [], 'q');
      }
    }

    // 2. Tickertape Search (Removed)

    // 3. Search Stocks
    // Auto and Yahoo-only go straight to Yahoo in step 4. IndianAPI is only
    // called when explicitly selected, because its free plan allows just
    // 500 requests/month and Auto's old IndianAPI result was overwritten by
    // Yahoo anyway.
    let stockQuotes: any[] = [];
    
    if (effectiveSource === 'indianapi') {
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
    }

    // 4. Search Yahoo Finance (primary for Auto, fallback for IndianAPI)
    if (stockQuotes.length === 0 || effectiveSource === 'yahoo') {
      console.log('Searching Yahoo Finance for:', q);
      // Raw Yahoo does not depend on yahoo-finance2's schema or crumb, so it
      // is the only Yahoo path. Empty results fall through to keyless Indian
      // sources instead of retrying Yahoo with a stricter parser.
      stockQuotes = (await yahooSearch(q, 10)).map((quote) => ({
        ...quote,
        source: 'Yahoo Finance',
      }));

      if (stockQuotes.length === 0) {
        console.log('Yahoo returned no quotes; trying Tickertape.');
        stockQuotes = await searchTickertape(q);
      }

      if (stockQuotes.length === 0) {
        console.log('Tickertape returned no quotes; trying Moneycontrol.');
        stockQuotes = await searchMoneycontrol(q);
      }

      console.log(`Stock search returned ${stockQuotes.length} quotes.`);
    }

    // Interleave stockQuotes and mfQuotes for a better mixed result.
    let combined: any[] = [];
    
    combined = [
      ...stockQuotes.slice(0, 3), 
      ...mfQuotes.slice(0, 2), 
      ...stockQuotes.slice(3), 
      ...mfQuotes.slice(2), 
      ...isinQuotes
    ];
    
    // Deduplicate by symbol
    const seenSymbols = new Set();
    combined = combined.filter(item => {
      if (seenSymbols.has(item.symbol)) {
        return false;
      }
      seenSymbols.add(item.symbol);
      return true;
    });
    
    // Manual mapping for specific queries
    if (q.toLowerCase().includes('axis small cap fund dir')) {
      combined.unshift({
        symbol: 'MF_120503',
        shortname: 'Axis Small Cap Fund Direct-Growth',
        longname: 'Axis Small Cap Fund Direct-Growth',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
    }

    if (q.toLowerCase().includes('zerodha nifty largemidcap 250')) {
      combined.unshift({
        symbol: 'MF_151125',
        shortname: 'Zerodha Nifty LargeMidcap 250 Index Fund Direct Growth',
        longname: 'Zerodha Nifty LargeMidcap 250 Index Fund Direct Growth',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
    }

    if (q.toLowerCase().includes('gold') || q.toLowerCase().includes('silver') || q.toLowerCase().includes('aura') || q.toLowerCase().includes('cash')) {
      if (q.toLowerCase().includes('gold') || q.toLowerCase().includes('aura')) {
        combined.unshift({
          symbol: 'GOLD-INR-GRAM',
          shortname: 'Physical Gold 24K (Per Gram)',
          longname: 'Physical Gold 24K (Price per Gram in INR)',
          quoteType: 'COMMODITY',
          source: 'Calculated (XAUINR)'
        });
      }
      if (q.toLowerCase().includes('silver')) {
        combined.unshift({
          symbol: 'SILVER-INR-GRAM',
          shortname: 'Physical Silver (Per Gram)',
          longname: 'Physical Silver (Price per Gram in INR)',
          quoteType: 'COMMODITY',
          source: 'Calculated (XAGINR)'
        });
      }
      if (q.toLowerCase().includes('cash')) {
        combined.unshift({
          symbol: 'CASH-INR',
          shortname: 'Cash in Hand (INR)',
          longname: 'Cash in Hand (INR)',
          quoteType: 'CASH',
          source: 'Manual'
        });
      }
    }
    if (q.toLowerCase().includes('edelweiss liquid fund')) {
      combined.unshift({
        symbol: '0P0001BA2H.BO',
        shortname: 'Edelweiss Liquid Fund - Regular Plan',
        longname: 'Edelweiss Liquid Fund - Regular Plan',
        quoteType: 'MUTUALFUND',
        source: 'Yahoo Finance'
      });
    }

    if (q.toLowerCase().includes('edelweiss') && q.toLowerCase().includes('liquid')) {
      // Add a generic one if not already added
      if (!combined.some(c => c.symbol === '0P0001BA2H.BO')) {
        combined.unshift({
          symbol: '0P0001BA2H.BO',
          shortname: 'Edelweiss Liquid Fund - Regular Plan',
          longname: 'Edelweiss Liquid Fund - Regular Plan',
          quoteType: 'MUTUALFUND',
          source: 'Yahoo Finance'
        });
      }
    }

    if (q.toLowerCase() === 'edelweiss' || q.toLowerCase() === 'edelweiss mutual fund') {
      combined.unshift({
        symbol: 'MF_120519',
        shortname: 'Edelweiss Small Cap Fund - Direct Plan - Growth',
        longname: 'Edelweiss Small Cap Fund - Direct Plan - Growth',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
      combined.unshift({
        symbol: '0P0001BA2H.BO',
        shortname: 'Edelweiss Liquid Fund - Regular Plan',
        longname: 'Edelweiss Liquid Fund - Regular Plan',
        quoteType: 'MUTUALFUND',
        source: 'Yahoo Finance'
      });
    }

    if (q.toLowerCase().includes('icici') && q.toLowerCase().includes('nifty 50') && q.toLowerCase().includes('index')) {
      // Direct Plan - Growth (Cumulative)
      combined.unshift({
        symbol: 'MF_120620',
        shortname: 'ICICI Pru Nifty 50 Index - Direct Growth',
        longname: 'ICICI Prudential Nifty 50 Index Fund - Direct Plan Cumulative Option (Growth)',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
      // Regular Plan - Growth (Cumulative)
      combined.unshift({
        symbol: 'MF_101349',
        shortname: 'ICICI Pru Nifty 50 Index - Growth',
        longname: 'ICICI Prudential Nifty 50 Index Fund - Cumulative Option (Growth)',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
      // Direct Plan - IDCW
      combined.unshift({
        symbol: 'MF_135391',
        shortname: 'ICICI Pru Nifty 50 Index - Direct IDCW',
        longname: 'ICICI Prudential Nifty 50 Index Fund - Direct Plan IDCW Option',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
      // Regular Plan - IDCW
      combined.unshift({
        symbol: 'MF_135390',
        shortname: 'ICICI Pru Nifty 50 Index - IDCW',
        longname: 'ICICI Prudential Nifty 50 Index Fund - IDCW Option',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
    }

    if (q.toLowerCase().includes('zerodha') && q.toLowerCase().includes('largemidcap')) {
      combined.unshift({
        symbol: 'MF_152156',
        shortname: 'Zerodha Nifty LargeMidcap 250 - Direct Growth',
        longname: 'Zerodha Nifty LargeMidcap 250 Index Fund - Direct Plan - Growth option',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
      combined.unshift({
        symbol: 'MF_152157',
        shortname: 'Zerodha ELSS Nifty LargeMidcap 250 - Direct Growth',
        longname: 'Zerodha ELSS Tax Saver Nifty LargeMidcap 250 Index Fund - Direct Plan - Growth option',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
    }

    if (q.toLowerCase().includes('edelweiss') && q.toLowerCase().includes('liquid')) {
      combined.unshift({
        symbol: 'MF_140196',
        shortname: 'Edelweiss Liquid Fund - Direct Growth',
        longname: 'Edelweiss Liquid Fund - Direct Plan - Growth Option',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
      combined.unshift({
        symbol: 'MF_140182',
        shortname: 'Edelweiss Liquid Fund - Regular Growth',
        longname: 'Edelweiss Liquid Fund - Regular Plan - Growth Option',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
    }

    if (q.toLowerCase().includes('edelweiss') && q.toLowerCase().includes('largemidcap')) {
      combined.unshift({
        symbol: 'MF_149343',
        shortname: 'Edelweiss NIFTY Large Midcap 250 - Direct Growth',
        longname: 'Edelweiss NIFTY Large Midcap 250 Index Fund - Direct Plan Growth',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
      combined.unshift({
        symbol: 'MF_149341',
        shortname: 'Edelweiss NIFTY Large Midcap 250 - Regular Growth',
        longname: 'Edelweiss NIFTY Large Midcap 250 Index Fund - Regular Plan Growth',
        quoteType: 'MUTUALFUND',
        source: 'MFAPI'
      });
    }

    if (q.toLowerCase().includes('edelweiss') && q.toLowerCase().includes('large') && q.toLowerCase().includes('midcap')) {
      // Prevent duplicates if they typed largemidcap as two words
      if (!combined.some(c => c.symbol === 'MF_149343')) {
        combined.unshift({
          symbol: 'MF_149343',
          shortname: 'Edelweiss NIFTY Large Midcap 250 - Direct Growth',
          longname: 'Edelweiss NIFTY Large Midcap 250 Index Fund - Direct Plan Growth',
          quoteType: 'MUTUALFUND',
          source: 'MFAPI'
        });
        combined.unshift({
          symbol: 'MF_149341',
          shortname: 'Edelweiss NIFTY Large Midcap 250 - Regular Growth',
          longname: 'Edelweiss NIFTY Large Midcap 250 Index Fund - Regular Plan Growth',
          quoteType: 'MUTUALFUND',
          source: 'MFAPI'
        });
      }
    }

    combined = combined.slice(0, 10);
    return NextResponse.json(combined);
  } catch (error: any) {
    console.error('Search API error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch data' }, { status: 500 });
  }
}
