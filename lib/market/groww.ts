import https from 'node:https';

// ---------------------------------------------------------------------------
// Groww mutual-fund portfolio fallback
//
// Yahoo's quoteSummary is rate-limited on shared cloud IPs and only exposes the
// top ten holdings. Groww publishes the full scheme portfolio (holdings,
// sectors, asset split) through its public scheme API. Use it when Yahoo has no
// data so a rate-limit cooldown does not blank out a fund.
//
// Groww's search defaults to Direct Growth schemes, so this fallback is only
// used for direct/unspecified growth plans. Regular and IDCW plans still rely
// on Yahoo, where the plan can be matched by name.
// ---------------------------------------------------------------------------

const GROWW_API = 'https://groww.in/v1/api';

const GROWW_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-IN,en;q=0.9',
  'Origin': 'https://groww.in',
  'Referer': 'https://groww.in/',
};

const GROWW_SCHEME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GROWW_PORTFOLIO_TTL_MS = 12 * 60 * 60 * 1000;
const GROWW_NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;
const GROWW_COOLDOWN_MS = 30 * 60 * 1000;

const growwSchemeCache = new Map<string, { value: string | null; expires: number }>();
const growwPortfolioCache = new Map<string, { value: any; expires: number }>();
let growwCooldownUntil = 0;

function fetchGrowwJson(url: string, timeoutMs = 20000): Promise<any> {
  if (Date.now() < growwCooldownUntil) {
    return Promise.reject(new Error('Groww requests are cooling down'));
  }

  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      // undici's fetch gives up connecting after 10s, which is too tight for
      // this host on some networks. Prefer IPv4 and allow a longer timeout.
      { headers: GROWW_HEADERS, family: 4, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode || 0;
        if (status === 403 || status === 429) {
          growwCooldownUntil = Date.now() + GROWW_COOLDOWN_MS;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`Groww HTTP ${status}`));
          return;
        }

        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('Groww returned invalid JSON'));
          }
        });
      },
    );

    req.on('timeout', () => req.destroy(new Error('Groww request timed out')));
    req.on('error', reject);
  });
}

const GROWW_NAME_STOPWORDS = new Set([
  'fund', 'plan', 'scheme', 'direct', 'regular', 'growth', 'idcw', 'dividend',
  'option', 'the', 'and', 'of', 'index',
]);

function growwNameTokens(value?: string | null) {
  return (String(value || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((token) => !GROWW_NAME_STOPWORDS.has(token));
}

// Overlap relative to the shorter name so "HDFC Flexi Cap" matches
// "HDFC Flexi Cap Fund", while an unrelated Edelweiss scheme does not.
function growwNameSimilarity(a?: string | null, b?: string | null) {
  const left = new Set(growwNameTokens(a));
  const right = new Set(growwNameTokens(b));
  if (left.size === 0 || right.size === 0) return 0;

  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.min(left.size, right.size);
}

function requestedFundPlan(name?: string | null) {
  const value = String(name || '');
  const wantIdcw = /idcw|dividend|\bdiv/i.test(value);
  return {
    wantDirect: /direct|\bdir/i.test(value),
    wantRegular: /regular|\breg/i.test(value),
    wantIdcw,
    wantGrowth: !wantIdcw && /growth|\bgr/i.test(value),
  };
}

function growwPlanMatches(mf: any, plan: ReturnType<typeof requestedFundPlan>) {
  const planType = String(mf?.plan_type || '').toLowerCase();
  const schemeType = String(mf?.scheme_type || '').toLowerCase();

  if (plan.wantDirect && planType && !planType.includes('direct')) return false;
  if (plan.wantRegular && planType && !planType.includes('regular')) return false;
  if (plan.wantIdcw && schemeType && !/(idcw|dividend)/.test(schemeType)) return false;
  if (plan.wantGrowth && schemeType && !schemeType.includes('growth')) return false;
  return true;
}

export function cleanFundNameForSearch(name: string) {
  return name
    .replace(/Direct Plan|Retail Plan|Regular Plan|Direct|Regular|Growth|IDCW|Dividend|Option|Plan|Scheme|Index Fund|Fund|Index/gi, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveGrowwScheme(name: string) {
  const cleanName = cleanFundNameForSearch(name) || name.trim();
  const cacheKey = cleanName.toLowerCase();
  const cached = growwSchemeCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  let resolved: string | null = null;
  try {
    const data = await fetchGrowwJson(
      `${GROWW_API}/search/v3/query/global/st_query?page=0&query=${encodeURIComponent(cleanName)}&web=true`,
    );
    const schemes: any[] = (Array.isArray(data?.data?.content) ? data.data.content : [])
      .filter((item: any) => item?.entity_type === 'Scheme' && typeof item.id === 'string');

    if (schemes.length > 0) {
      const ranked = schemes
        .map((item: any) => {
          const id = String(item.id);
          const label = `${item.title || ''} ${id.replace(/-/g, ' ')}`;
          const similarity = growwNameSimilarity(cleanName, label);
          let score = similarity * 10;
          if (/-direct-growth$/.test(id)) score += 3;
          if (/-regular-/.test(id)) score -= 2;
          if (/(idcw|dividend)/.test(id)) score -= 2;
          return { id, similarity, score };
        })
        .sort((a, b) => b.score - a.score);

      // A single search hit is trusted even when the AMC renamed the scheme
      // (e.g. ICICI Prudential Bluechip -> ICICI Prudential Large Cap), but
      // only when the AMC name still lines up. This blocks a generic query
      // from resolving to an unrelated fund.
      const requestedTokens = growwNameTokens(cleanName);
      const candidateTokens = new Set(growwNameTokens(`${ranked[0].id} ${schemes[0].title || ''}`));
      const amc = requestedTokens[0] || '';
      const amcMatches = Boolean(amc) && (
        candidateTokens.has(amc) ||
        Array.from(candidateTokens).some((token) => token.includes(amc) || amc.includes(token))
      );

      if ((schemes.length === 1 && amcMatches) || ranked[0].similarity >= 0.6) {
        resolved = ranked[0].id;
      }
    }
  } catch (e: any) {
    console.warn(`[HOLDINGS API] Groww search failed for "${cleanName}":`, e.message || e);
    return null;
  }

  growwSchemeCache.set(cacheKey, {
    value: resolved,
    expires: Date.now() + (resolved ? GROWW_SCHEME_TTL_MS : GROWW_NEGATIVE_TTL_MS),
  });
  return resolved;
}

const GROWW_HOLDING_FIELDS = [
  'scheme_code', 'portfolio_date', 'company_name', 'nature_name',
  'sector_name', 'instrument_name', 'rating', 'market_value', 'corpus_per',
  'market_cap', 'rating_market_cap', 'stock_search_id',
];

function normalizeGrowwHolding(row: any) {
  if (!Array.isArray(row)) return row || {};
  const normalized: Record<string, any> = {};
  GROWW_HOLDING_FIELDS.forEach((field, index) => {
    normalized[field] = row[index];
  });
  return normalized;
}

async function fetchGrowwScheme(searchId: string) {
  const cached = growwPortfolioCache.get(searchId);
  if (cached && cached.expires > Date.now()) return cached.value;

  let mf: any = null;
  try {
    // The v1 payload is much smaller; fall back to v6 when it lacks holdings.
    mf = await fetchGrowwJson(
      `${GROWW_API}/data/mf/web/v1/scheme/search/${encodeURIComponent(searchId)}`,
    );
    if (!Array.isArray(mf?.holdings) || mf.holdings.length === 0) {
      mf = await fetchGrowwJson(
        `${GROWW_API}/data/mf/web/v6/scheme/search/${encodeURIComponent(searchId)}`,
      );
    }
  } catch (e: any) {
    console.warn(`[HOLDINGS API] Groww scheme fetch failed for ${searchId}:`, e.message || e);
    return null;
  }

  if (!mf || !Array.isArray(mf.holdings) || mf.holdings.length === 0) return null;
  growwPortfolioCache.set(searchId, {
    value: mf,
    expires: Date.now() + GROWW_PORTFOLIO_TTL_MS,
  });
  return mf;
}

function mapGrowwPortfolio(mf: any, requestedSymbol: string) {
  const rows = (Array.isArray(mf?.holdings) ? mf.holdings : [])
    .map(normalizeGrowwHolding)
    .filter((row: any) => row.company_name && Number(row.corpus_per) > 0);

  const total = rows.reduce((sum: number, row: any) => sum + (Number(row.corpus_per) || 0), 0);
  if (rows.length === 0 || total <= 0) return null;

  const holdings = rows
    .map((row: any) => ({
      symbol: row.stock_search_id || row.company_name,
      holdingName: row.company_name,
      // Groww publishes corpus percentages. Normalize against the positive
      // rows because derivative hedges can carry negative weights.
      holdingPercent: (Number(row.corpus_per) || 0) / total,
    }))
    .sort((a: any, b: any) => b.holdingPercent - a.holdingPercent);

  const sectorTotals = new Map<string, number>();
  const allocation = { stockPosition: 0, bondPosition: 0, cashPosition: 0, otherPosition: 0 };
  for (const row of rows) {
    const percentage = ((Number(row.corpus_per) || 0) / total) * 100;
    const sector = String(row.sector_name || 'Other').trim() || 'Other';
    sectorTotals.set(sector, (sectorTotals.get(sector) || 0) + percentage);

    const nature = String(row.nature_name || '').toUpperCase();
    if (nature.includes('EQUITY')) allocation.stockPosition += percentage;
    else if (nature.includes('DEBT') || nature.includes('BOND')) allocation.bondPosition += percentage;
    else if (nature.includes('CASH')) allocation.cashPosition += percentage;
    else allocation.otherPosition += percentage;
  }

  const round = (value: number) => Number(value.toFixed(2));
  const sectorWeightings = Array.from(sectorTotals.entries())
    .map(([sector, percentage]) => ({ sector, percentage: round(percentage) }))
    .filter((item) => item.percentage > 0)
    .sort((a, b) => b.percentage - a.percentage);

  const rawDate = rows[0]?.portfolio_date;
  const parsedDate = rawDate ? new Date(rawDate) : null;
  const asOf = parsedDate && !Number.isNaN(parsedDate.getTime())
    ? parsedDate.toISOString()
    : null;

  return {
    source: 'Groww',
    symbol: requestedSymbol,
    providerSymbol: mf.scheme_code ? String(mf.scheme_code) : null,
    categoryName: mf.sub_category || mf.category || null,
    assetAllocation: {
      stockPosition: round(allocation.stockPosition),
      bondPosition: round(allocation.bondPosition),
      cashPosition: round(allocation.cashPosition),
      otherPosition: round(allocation.otherPosition),
    },
    marketCapWeightage: null,
    sectorWeightings,
    holdings,
    asOf,
  };
}

const isEtfLikeName = (name?: string | null) =>
  /\b(etf|bees|exchange[-\s]?traded)\b/i.test(name || '');

function shouldTryGroww(symbol: string, name?: string | null) {
  if (!name || isEtfLikeName(name)) return false;
  if (/^MF_/i.test(symbol) || /^\d{5,6}$/.test(symbol)) return true;
  if (/^0P.*\.(BO|NS)$/i.test(symbol)) return true;
  return /\.(BO|NS)$/i.test(symbol) && /\bfund\b/i.test(name);
}

export async function getGrowwFundPortfolio(symbol: string, name?: string | null) {
  if (!name || !shouldTryGroww(symbol, name)) return null;

  const plan = requestedFundPlan(name);
  // Groww search resolves direct-growth schemes only; do not risk serving the
  // wrong plan for regular/IDCW holdings.
  if (plan.wantRegular || plan.wantIdcw) return null;

  try {
    const searchId = await resolveGrowwScheme(name);
    if (!searchId) return null;

    const mf = await fetchGrowwScheme(searchId);
    if (!mf) return null;

    if (!growwPlanMatches(mf, plan)) {
      console.log(
        `[HOLDINGS API] Groww scheme ${searchId} is ${mf.plan_type}/${mf.scheme_type}; requested plan does not match for ${symbol}`,
      );
      return null;
    }

    const mapped = mapGrowwPortfolio(mf, symbol);
    if (mapped) {
      console.log(
        `[HOLDINGS API] Groww fallback served ${mapped.holdings.length} holdings for ${symbol} (${searchId})`,
      );
    }
    return mapped;
  } catch (e: any) {
    console.warn(`[HOLDINGS API] Groww fallback failed for ${symbol}:`, e.message || e);
    return null;
  }
}

