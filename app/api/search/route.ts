import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahoo = new YahooFinance();

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

// Global cache for the full list of mutual funds (approx 37k items, ~5MB)
let cachedMfList: any[] = [];
let mfListLastFetched = 0;

async function getFullMfList() {
  const now = Date.now();
  // Cache for 24 hours
  if (cachedMfList.length > 0 && (now - mfListLastFetched < 24 * 60 * 60 * 1000)) {
    return cachedMfList;
  }
  try {
    const res = await fetch('https://api.mfapi.in/mf');
    if (res.ok) {
      cachedMfList = await res.json();
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

// Tickertape API removed.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');
  const source = searchParams.get('source'); // New source parameter

  if (!q) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
  }

  try {
    console.log(`Search request: q=${q}, source=${source}`);
    // Default source if tickertape or unknown is provided
    const effectiveSource = (!source || source === 'tickertape') ? 'default' : source;
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
    if (effectiveSource !== 'yahoo' && effectiveSource !== 'indianapi' && effectiveSource !== 'newapi') {
      // Smart MF Search Logic using cached full list
      const allMfs = await getFullMfList();
      
      if (allMfs && allMfs.length > 0) {
        const words = q.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
        
        const scored = allMfs.map((mf: any) => {
          const name = mf.schemeName.toLowerCase();
          let score = 0;
          let allMatched = true;
          
          for (const w of words) {
            if (name.includes(w)) {
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
          if (name.includes(q.toLowerCase())) score += 50;
          
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
          quoteType: 'MUTUALFUND',
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
            quoteType: 'MUTUALFUND',
            source: 'MFAPI'
          }));
        }, [], 'q');
      }
    }

    // 2. Tickertape Search (Removed)
    let tickertapeQuotes: any[] = [];

    // 3. Search Stocks (IndianAPI as backup)
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
    } else if (effectiveSource === 'newapi') {
      stockQuotes = await fetchWithFailover(NEW_STOCK_APIS, q, (data) => {
        console.log('NewAPI response:', data);
        const results = Array.isArray(data) ? data : (data.results || data.data || []);
        if (Array.isArray(results)) {
          return results.map(s => ({
            symbol: s.symbol || s.ticker,
            shortname: s.shortname || s.name,
            longname: s.longname || s.name,
            quoteType: 'EQUITY',
            source: 'KoyebAPI'
          }));
        }
        return [];
      }, STOCK_KEYS, 'query');
    } else if (effectiveSource === 'yahoo') {
      // Handled in step 4
    } else if (effectiveSource === 'default') {
      // Fallback for generic search
      stockQuotes = await fetchWithFailover(STOCK_APIS, q, (data) => {
        const results = Array.isArray(data) ? data : (data.results || data.data || []);
        if (Array.isArray(results)) {
          return results.map(s => ({
            symbol: s.symbol || s.ticker,
            shortname: s.shortname || s.name,
            longname: s.longname || s.name,
            quoteType: 'EQUITY',
            source: 'IndianAPI'
          }));
        }
        return [];
      }, STOCK_KEYS, 'query');
    }

    // 4. Search Yahoo Finance as a final fallback
    if (stockQuotes.length === 0 || effectiveSource === 'yahoo' || effectiveSource === 'default') {
      try {
        // If the query doesn't explicitly mention NSE, BSE, .NS, or .BO, bias towards NSE
        const isIndian = q.toLowerCase().includes('nse') || 
                         q.toLowerCase().includes('bse') || 
                         q.toLowerCase().includes('.ns') || 
                         q.toLowerCase().includes('.bo');
        
        // Check if it looks like a crypto or US stock
        const isCryptoOrUS = q.includes('-') || /^[A-Z]{1,5}$/.test(q.toUpperCase());
        
        const searchQ = (isIndian || isCryptoOrUS) ? q : `${q} NSE`;
        
        console.log('Searching Yahoo Finance via direct fetch for:', searchQ);
        const yahooRes = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQ)}&quotesCount=6&newsCount=0`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json'
          }
        });
        
        if (yahooRes.ok) {
          const yahooData = await yahooRes.json();
          stockQuotes = (yahooData.quotes || []).map((q: any) => ({
            symbol: q.symbol,
            shortname: q.shortname,
            longname: q.longname,
            quoteType: q.quoteType,
            source: 'Yahoo Finance'
          }));
          console.log('Yahoo Finance direct fetch successful.');
        } else {
          console.error(`Yahoo direct fetch failed with status: ${yahooRes.status}`);
        }
      } catch (e: any) {
        console.error('Yahoo Finance search error:', e.message || e);
      }
    }

    // Interleave stockQuotes and mfQuotes for a better mixed result.
    let combined: any[] = [];
    const maxStocks = stockQuotes.length > 0 ? 5 : 0;
    const maxMfs = mfQuotes.length > 0 ? 5 : 0;
    
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
        source: 'Tickertape'
      });
    }

    if (q.toLowerCase().includes('zerodha nifty largemidcap 250')) {
      combined.unshift({
        symbol: 'MF_151125',
        shortname: 'Zerodha Nifty LargeMidcap 250 Index Fund Direct Growth',
        longname: 'Zerodha Nifty LargeMidcap 250 Index Fund Direct Growth',
        quoteType: 'MUTUALFUND',
        source: 'Tickertape'
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
        source: 'Tickertape'
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
