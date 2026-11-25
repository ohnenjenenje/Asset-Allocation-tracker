import { NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';
import { normalizeSectorWeightings } from '@/lib/portfolio-utils';
import { cleanFundNameForSearch, getGrowwFundPortfolio } from '@/lib/market/groww';
import {
  yahooChartQuote,
  yahooQuoteSummary,
  yahooQuotes,
  yahooSearch,
} from '@/lib/market/yahoo';

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

function planMatches(label: string, requestedName?: string | null) {
  const wantDirect = /direct|\bdir/i.test(requestedName || '');
  const wantRegular = /regular|\breg/i.test(requestedName || '');
  const wantIdcw = /idcw|dividend|\bdiv/i.test(requestedName || '');
  const wantGrowth = !wantIdcw && /growth|\bgr/i.test(requestedName || '');
  if (wantDirect && !/direct|\bdir/i.test(label)) return false;
  if (wantRegular && !/regular|\breg/i.test(label)) return false;
  if (wantIdcw && !/idcw|div/i.test(label)) return false;
  if (wantGrowth && /idcw|div/i.test(label)) return false;
  return true;
}

const ETF_NAME_STOPWORDS = new Set([
  'etf', 'bees', 'fund', 'index', 'indices', 'plan', 'scheme', 'direct',
  'regular', 'growth', 'idcw', 'dividend', 'option', 'limited', 'ltd',
  'amc', 'the', 'and', 'of', 'exchange', 'traded',
]);

function isEtfLikeName(name?: string | null) {
  return /\b(etf|bees|exchange[-\s]?traded)\b/i.test(name || '');
}

function nameTokens(name?: string | null) {
  return (String(name || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((token) => !ETF_NAME_STOPWORDS.has(token));
}

// Guard the Yahoo fallback for ETFs: a fund with a similar AMC name is not
// necessarily the same index. Example: "Mirae Asset Nifty 200 Alpha 30 ETF"
// must not use a "Mirae Asset Nifty LargeMidcap 250" fund.
function fundNameMatchesEtf(fundLabel: string, requestedName?: string | null) {
  if (!isEtfLikeName(requestedName)) return true;

  const wanted = nameTokens(requestedName);
  if (wanted.length === 0) return true;
  const available = new Set(nameTokens(fundLabel));

  // Every number in the ETF name is part of the index identity (50, 200, 30...).
  const wantedNumbers = wanted.filter((token) => /^\d+$/.test(token));
  if (wantedNumbers.some((token) => !available.has(token))) return false;

  const wantedWords = wanted.filter((token) => !/^\d+$/.test(token) && token.length > 2);
  if (wantedWords.length === 0) return true;
  const overlap = wantedWords.filter((token) => available.has(token)).length;
  return overlap >= Math.min(2, wantedWords.length);
}

// ---------------------------------------------------------------------------
// Tickertape index look-through for Indian ETFs
//
// Yahoo has prices for NSE/BSE-listed ETFs but no fundamentals, and Upvaly
// returns metadata only for them. Tickertape, however, knows which index each
// ETF tracks and publishes that index's constituents with free-float shares
// and live prices. Since an index ETF simply copies its index, we can rebuild
// the holdings list and sector split from the index.
//
// This is an index look-through, not the ETF's exact published portfolio, so
// callers get a `note` explaining that.
// ---------------------------------------------------------------------------

const TICKERTAPE_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://www.tickertape.in',
  'Referer': 'https://www.tickertape.in/',
};

// Yahoo symbol (without exchange suffix) -> Tickertape ETF SID. Only entries
// whose SID is verified are listed; unknown ETFs fall back to Tickertape
// search, which requires an exact ticker or name match.
const TICKERTAPE_ETF_SIDS: Record<string, string> = {
  NIFTYBEES: 'NBES',
  BANKBEES: 'BBES',
  ITBEES: 'NIPD',
  JUNIORBEES: 'JBES',
  SETFNIF50: 'SBFP',
  KOTAKNIFTY: 'KOTK',
  NIFTYETF: 'MIRA',
  MAN50ETF: 'MIRA',
  NEXT50: 'MIRE',
  MANXT50: 'MIRE',
  MON100: 'N100',
  N100: 'N100',
  MAFANG: 'MAFAN',
  GOLDBEES: 'GBES',
  ICICINIFTY: 'ICNI',
  ICICINXT50: 'ICIT',
  ICICIBANKN: 'ICIA',
  HDFCNIFETF: 'HDFN',
  IDFNIFTYET: 'IFCN',
  NIFTYEES: 'EETS',
  KOTAKBKETF: 'KOTM',
  PSUBNKBEES: 'PSUB',
  CPSEETF: 'GOMS',
  NETFIT: 'NIPD',
  NETFNIF100: 'NIPO',
  NETFCONSUM: 'NCON',
  NETFNV20: 'NNET',
  HNGSNGBEES: 'HNGS',
  SHARIABEES: 'SBET',
  UTINEXT50: 'UTII',
  SETFNN50: 'SBIN',
  M100: 'M100',
  M50: 'M50',
  MGOLD: 'MGOL',
  BSLSENETFG: 'BSL',
};

// AMFI scheme codes for Indian ETFs. The sheet sometimes stores an ETF as
// MF_<code> instead of its exchange symbol.
const TICKERTAPE_ETF_SCHEME_CODES: Record<string, string> = {
  '140084': 'NBES', // Nippon India ETF Nifty 50 BeES
  '148408': 'NIPD', // Nippon India ETF Nifty IT
};

const etfSidCache = new Map<string, { value: string | null; expires: number }>();
const indexLookthroughCache = new Map<
  string,
  { expires: number; holdings: any[]; sectorWeightings: any[] } | null
>();
const INDEX_LOOKTHROUGH_TTL_MS = 12 * 60 * 60 * 1000;
const ETF_SID_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchTickertapeJson(url: string) {
  const res = await fetch(url, { headers: TICKERTAPE_HEADERS, cache: 'no-store' });
  if (!res.ok) throw new Error(`Tickertape HTTP ${res.status}`);
  const json = await res.json();
  if (json?.success === false) {
    throw new Error(json.error || 'Tickertape request failed');
  }
  return json?.data;
}

// Token-sorted comparison so "Nippon India ETF Nifty 50 BeES" matches
// "Nippon India Nifty 50 Bees ETF".
function normalizeFundName(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

async function resolveTickertapeEtfSid(baseTicker: string, name?: string | null) {
  const mapped = TICKERTAPE_ETF_SIDS[baseTicker];
  if (mapped) return mapped;
  const cachedSid = etfSidCache.get(baseTicker);
  if (cachedSid && cachedSid.expires > Date.now()) return cachedSid.value;

  let sid: string | null = null;
  const queries = Array.from(new Set([baseTicker, name || ''].filter(Boolean)));

  for (const query of queries) {
    try {
      const data = await fetchTickertapeJson(
        `https://api.tickertape.in/search?text=${encodeURIComponent(query)}`,
      );
      const etfs = (data?.stocks || []).filter((item: any) => item?.type === 'etf');

      const tickerMatch = etfs.find(
        (item: any) => String(item.ticker || '').toUpperCase() === baseTicker,
      );
      if (tickerMatch?.sid) {
        sid = tickerMatch.sid;
        break;
      }

      if (name) {
        const wanted = normalizeFundName(name);
        const nameMatch = etfs.find(
          (item: any) => normalizeFundName(item.name || '') === wanted,
        );
        if (nameMatch?.sid) {
          sid = nameMatch.sid;
          break;
        }
      }
    } catch (e: any) {
      console.warn(
        `[HOLDINGS API] Tickertape ETF search failed for "${query}":`,
        e.message || e,
      );
    }
  }

  etfSidCache.set(baseTicker, {
    value: sid,
    expires: Date.now() + ETF_SID_TTL_MS,
  });
  return sid;
}

async function getTickertapeIndexLookthrough(trIndex: string) {
  const cached = indexLookthroughCache.get(trIndex);
  if (cached && cached.expires > Date.now()) return cached;

  const data = await fetchTickertapeJson(
    `https://api.tickertape.in/indices/constituents/${encodeURIComponent(trIndex)}`,
  );
  const constituents = Array.isArray(data?.constituents) ? data.constituents : [];

  const rows = constituents
    .map((c: any) => ({
      ticker: String(c.ticker || '').toUpperCase(),
      name: c.name || c.ticker || '',
      sector: c.sector || 'Other',
      freeFloat: Number(c.freeFloat) || 0,
      price: Number(c.lastPrice) || 0,
    }))
    .filter((c: any) => c.ticker && c.freeFloat > 0 && c.price > 0);

  const total = rows.reduce(
    (sum: number, c: any) => sum + c.freeFloat * c.price,
    0,
  );
  if (rows.length === 0 || total <= 0) return null;

  const holdings = rows
    .map((c: any) => ({
      symbol: `${c.ticker}.NS`,
      holdingName: c.name,
      // Existing callers expect a 0-1 fraction here.
      holdingPercent: (c.freeFloat * c.price) / total,
    }))
    .sort((a: any, b: any) => b.holdingPercent - a.holdingPercent);

  const sectorTotals = new Map<string, number>();
  for (const c of rows) {
    const pct = ((c.freeFloat * c.price) / total) * 100;
    sectorTotals.set(c.sector, (sectorTotals.get(c.sector) || 0) + pct);
  }
  const sectorWeightings = Array.from(sectorTotals.entries())
    .map(([sector, percentage]) => ({ sector, percentage: Number(percentage.toFixed(2)) }))
    .sort((a, b) => b.percentage - a.percentage);

  const result = {
    expires: Date.now() + INDEX_LOOKTHROUGH_TTL_MS,
    holdings,
    sectorWeightings,
  };
  indexLookthroughCache.set(trIndex, result);
  return result;
}

async function getTickertapeEtfLookthrough(symbol: string, name?: string | null) {
  const upper = symbol.toUpperCase();
  // Morningstar mutual-fund IDs are handled by the Yahoo/Upvaly flow.
  if (/^0P/.test(upper)) return null;

  try {
    let sid: string | null = null;

    // The sheet sometimes stores an ETF as MF_<AMFI code> (e.g. MF_140084).
    const schemeCode = upper.replace(/^MF_/, '');
    if (/^\d{5,6}$/.test(schemeCode)) {
      sid = TICKERTAPE_ETF_SCHEME_CODES[schemeCode] || null;
      if (!sid) return null;
    } else if (/\.(NS|BO)$/.test(upper)) {
      const baseTicker = upper.replace(/\.(NS|BO)$/, '');

      // Avoid a pointless Tickertape search for ordinary Indian stocks. Known
      // SIDs, ETF-sounding tickers, and ETF-sounding names are enough.
      const nameLooksLikeEtf = /\b(etf|bees|exchange[-\s]?traded)\b/i.test(name || '');
      const tickerLooksLikeEtf = /(ETF|BEES|NIFTY|NEXT50|JUNIOR|GOLDBEES|SILVERBEES|LIQUIDBEES)/.test(baseTicker);
      if (!TICKERTAPE_ETF_SIDS[baseTicker] && !nameLooksLikeEtf && !tickerLooksLikeEtf) {
        return null;
      }

      sid = await resolveTickertapeEtfSid(baseTicker, name);
      if (!sid) return null;
    } else {
      return null;
    }

    const info = await fetchTickertapeJson(
      `https://api.tickertape.in/etfs/info/${encodeURIComponent(sid)}`,
    );
    const trIndex = info?.info?.trIndex;
    if (!trIndex) return null;

    const lookthrough = await getTickertapeIndexLookthrough(trIndex);
    if (!lookthrough || lookthrough.holdings.length === 0) return null;

    const indexName = info?.info?.trIndexName || trIndex;
    return {
      source: 'Tickertape (tracked index)',
      symbol,
      categoryName: 'ETF',
      assetAllocation: {
        stockPosition: 100,
        bondPosition: 0,
        cashPosition: 0,
        otherPosition: 0,
      },
      // Present but empty so clients don't treat the payload as stale and
      // refetch on every render. Tickertape's index feed has no cap split.
      marketCapWeightage: null,
      sectorWeightings: lookthrough.sectorWeightings,
      holdings: lookthrough.holdings,
      lookthrough: 'tracked-index',
      note: `Based on the ${indexName} tracked by this ETF, not the ETF's exact portfolio.`,
    };
  } catch (e: any) {
    console.warn(
      `[HOLDINGS API] Tickertape ETF look-through failed for ${symbol}:`,
      e.message || e,
    );
    return null;
  }
}

// Pick the Yahoo mutual-fund symbol that best matches the requested plan.
// Yahoo's search returns bare symbols, so we batch-quote the candidates to
// read their long names (e.g. "HDFC Flexi Cap Dir Gr").
async function pickBestYahooFund(symbols: string[], requestedName?: string | null) {
  const candidates = symbols.filter((s) => s && s.startsWith('0P')).slice(0, 6);
  if (candidates.length === 0) return null;

  const wantDirect = /direct|\bdir/i.test(requestedName || '');
  const wantRegular = /regular|\breg/i.test(requestedName || '');
  const wantIdcw = /idcw|dividend|\bdiv/i.test(requestedName || '');
  const wantGrowth = !wantIdcw && /growth|\bgr/i.test(requestedName || '');

  const quotes = await yahooQuotes(candidates);
  if (quotes.length === 0) {
    return isEtfLikeName(requestedName) ? null : candidates[0];
  }

  let best: string | null = null;
  let bestScore = -Infinity;
  for (const quote of quotes) {
    if (!quote?.symbol) continue;
    const label = `${quote.longName || ''} ${quote.shortName || ''}`;
    if (!fundNameMatchesEtf(label, requestedName)) {
      console.log(`Skipping Yahoo fund ${quote.symbol} ("${label.trim()}") because it does not match the ETF name`);
      continue;
    }
    let score = 0;
    if (wantDirect && /direct|\bdir/i.test(label)) score += 4;
    if (wantRegular && /regular|\breg/i.test(label)) score += 4;
    if (wantIdcw && /idcw|div/i.test(label)) score += 3;
    if (wantGrowth && /growth|\bgr/i.test(label)) score += 3;
    if (wantGrowth && /idcw|div/i.test(label)) score -= 3;
    if (score > bestScore) {
      bestScore = score;
      best = quote.symbol;
    }
  }
  return best;
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

    // Indian index ETFs: build holdings/sectors from the index Tickertape says
    // the ETF tracks. Must run before the AMFI/Upvaly mapping because those
    // sources only return ETF metadata.
    const etfLookthrough = await getTickertapeEtfLookthrough(symbol, name);
    if (etfLookthrough) {
      return NextResponse.json(etfLookthrough);
    }

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
            const upvalyHoldings = Array.isArray(d.holdings) ? d.holdings : [];
            const upvalySectors = Array.isArray(d.sectors) ? d.sectors : [];
            const allocation = d.portfolio?.assetAllocation;
            const marketCap = d.portfolio?.marketCapWeightage;
            const hasAllocation =
              allocation && Object.values(allocation).some((v) => parseFloat(String(v)) > 0);
            const hasMarketCap =
              marketCap && Object.values(marketCap).some((v) => parseFloat(String(v)) > 0);
            const hasPortfolio =
              upvalyHoldings.length > 0 ||
              upvalySectors.length > 0 ||
              Boolean(hasAllocation) ||
              Boolean(hasMarketCap);

            // Upvaly increasingly returns only scheme metadata (NAV etc.) and
            // empty portfolio arrays. Treat that as a miss so callers fall
            // through to Yahoo instead of showing a fund with no holdings.
            if (hasPortfolio) {
              return NextResponse.json({
                source: 'Upvaly FinAPI',
                symbol: symbol,
                categoryName: d.schemeCategoryLabel || d.schemeCategory || null,
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
                sectorWeightings: upvalySectors.map((s: any) => ({
                  sector: s.sector,
                  percentage: parseFloat(s.weightage)
                })),
                holdings: upvalyHoldings.map((h: any) => ({
                  symbol: h.name,
                  holdingName: h.name,
                  holdingPercent: parseFloat(h.weightage) / 100
                }))
              });
            }

            console.log(
              `[HOLDINGS API] Upvaly returned metadata only for ${schemeCode} (holdings=0, sectors=0); trying Yahoo fallback`,
            );
          }
        }
      } catch (e: any) {
        console.error(`Upvaly fetch failed for ${schemeCode}:`, e.message || e);
        // Let it fall through to Yahoo Finance fallback below
      }
    }
    // --- END UPVALY INTEGRATION ---


    let lookupSymbol = resolvedSymbol;

    // 2. Fallback to Yahoo Finance if Tickertape failed
    // Ensure we don't call Yahoo for symbols we know will fail
    const knownFailingSymbols = ['0P0001S0S9.BO', '0P0000XW0K.BO', '0P0011MAX.BO'];
    let skipYahoo = false;
    if (!tickertapeData && !knownFailingSymbols.includes(lookupSymbol)) {
      try {
        let yfSymbol = lookupSymbol;
        
        // If the symbol is a Tickertape SID / AMFI code, we can't use it
        // directly in Yahoo Finance. Try the sheet's YahooSymbol mapping, then
        // a search by name.
        if (isMutualFund) {
          const sheetYahooSymbol = await getYahooSymbolFromSheet(symbol);
          let useSheetSymbol = false;
          if (sheetYahooSymbol) {
            const quote = await yahooChartQuote(sheetYahooSymbol);
            if (!quote) {
              // Yahoo is unavailable; trust the sheet mapping rather than
              // dropping a known-good symbol.
              useSheetSymbol = true;
            } else {
              const label = `${quote.longName || ''} ${quote.shortName || ''}`;
              useSheetSymbol = planMatches(label, name) && fundNameMatchesEtf(label, name);
              if (!useSheetSymbol) {
                console.log(
                  `Sheet mapping ${sheetYahooSymbol} ("${label.trim()}") does not match the requested plan/fund; searching by name`,
                );
              }
            }
          }

          if (useSheetSymbol && sheetYahooSymbol) {
            yfSymbol = sheetYahooSymbol;
            console.log(`Found Yahoo symbol in sheet: ${symbol} -> ${yfSymbol}`);
          } else if (name) {
            console.log(`Target symbol is a mutual fund (${symbol}), searching Yahoo Finance by name: ${name}`);
            const cleanName = cleanFundNameForSearch(name);
            const ySearch = await yahooSearch(cleanName, 8);
            const candidates = ySearch
              .filter((q) => q.quoteType === 'MUTUALFUND' || q.quoteType === 'ETF')
              .map((q) => q.symbol)
              .filter(Boolean);
            const best = await pickBestYahooFund(candidates, name);
            if (best) {
              yfSymbol = best;
              console.log(`Found Yahoo symbol via name search: ${yfSymbol}`);
            } else if (/^0P/i.test(symbol)) {
              // The sheet symbol is already a Morningstar/Yahoo fund ID. Name
              // search can miss renamed funds, so retry the exact symbol.
              yfSymbol = symbol;
              console.log(`Falling back to the original Morningstar symbol for Yahoo: ${yfSymbol}`);
            } else {
              console.log(`Could not find Yahoo symbol for name: ${cleanName}`);
              skipYahoo = true;
            }
          } else {
            skipYahoo = true;
          }
        }

        if (!skipYahoo && !yfSymbol.startsWith('MF_')) {
          console.log(`Fetching holdings for target symbol: ${yfSymbol}`);
          const result = await yahooQuoteSummary(yfSymbol, ['topHoldings', 'fundProfile']);
          
          if (result) {
            const holdings = (result.topHoldings?.holdings || []).map((h: any) => ({
              symbol: h.symbol,
              holdingName: h.holdingName,
              holdingPercent: h.holdingPercent
            }));
            const sectorWeightings = normalizeSectorWeightings(
              result.topHoldings?.sectorWeightings,
            );
            const hasYahooPortfolio =
              holdings.length > 0 ||
              sectorWeightings.length > 0 ||
              (result.topHoldings?.stockPosition || 0) > 0;

            if (hasYahooPortfolio) {
              // When an ETF has no direct Yahoo record, the fallback may resolve
              // to a same-index mutual fund. Label that clearly instead of
              // presenting it as the ETF's own portfolio.
              const isEtfProxy = isEtfLikeName(name) && yfSymbol.startsWith('0P');
              tickertapeData = {
                holdings,
                sectorWeightings,
                assetAllocation: {
                  stockPosition: (result.topHoldings?.stockPosition || 0) * 100,
                  bondPosition: (result.topHoldings?.bondPosition || 0) * 100,
                  cashPosition: (result.topHoldings?.cashPosition || 0) * 100,
                  otherPosition: (result.topHoldings?.otherPosition || 0) * 100,
                },
                categoryName: (result.fundProfile as any)?.categoryName || null,
                symbol: yfSymbol,
                source: isEtfProxy ? 'Yahoo Finance (same-index fund)' : 'Yahoo Finance',
                ...(isEtfProxy
                  ? {
                      lookthrough: 'proxy-fund',
                      note: `Holdings are from a same-index mutual fund (${yfSymbol}), not the ETF's exact portfolio.`,
                    }
                  : {}),
              };
            } else {
              console.log(`Yahoo returned no holdings for ${yfSymbol}`);
            }
          }
        } else if (skipYahoo) {
          console.log(`Skipping Yahoo Finance fetch because no Yahoo symbol is available for ${symbol}`);
        } else {
           console.log(`Skipping Yahoo Finance fetch because symbol is still a Tickertape SID: ${yfSymbol}`);
        }
      } catch (e: any) {
        console.error(`Yahoo Finance fetch failed for ${lookupSymbol}`, e);
      }
    }

    // Yahoo is rate-limited on shared cloud IPs and sometimes returns only a
    // sector split. Groww publishes the exact mutual-fund portfolio, so use it
    // whenever Yahoo has no individual holdings.
    const hasYahooHoldings =
      Array.isArray(tickertapeData?.holdings) && tickertapeData.holdings.length > 0;
    if (!hasYahooHoldings) {
      const growwData = await getGrowwFundPortfolio(symbol, name);
      if (growwData) {
        tickertapeData = { ...(tickertapeData || {}), ...growwData };
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
