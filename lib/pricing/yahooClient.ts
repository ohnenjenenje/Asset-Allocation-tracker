// DIP: price route depends on this abstraction, not raw fetch URLs inline

const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  Accept: 'application/json',
};

export const yahooClient = {
  async quote(symbol: string) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`,
        { headers: YAHOO_HEADERS },
      );
      if (!res.ok) throw new Error(`Yahoo quote failed: ${res.status}`);
      const data = await res.json();
      return data?.quoteResponse?.result?.[0] ?? null;
    } catch (e) {
      console.error(`Error in Yahoo quote for ${symbol}:`, e);
      return null;
    }
  },

  async quoteSummary(symbol: string, modules: string[]) {
    try {
      const mods = modules.join(',');
      const res = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${mods}`,
        { headers: YAHOO_HEADERS },
      );
      if (!res.ok) throw new Error(`Yahoo summary failed: ${res.status}`);
      const data = await res.json();
      return data?.quoteSummary?.result?.[0] ?? null;
    } catch (e) {
      console.error(`Error in Yahoo summary for ${symbol}:`, e);
      return null;
    }
  },

  async search(query: string, quotesCount = 10) {
    try {
      const res = await fetch(
        `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=${quotesCount}&newsCount=0`,
        { headers: YAHOO_HEADERS },
      );
      if (!res.ok) throw new Error(`Yahoo search failed: ${res.status}`);
      return (await res.json()) ?? { quotes: [] };
    } catch (e) {
      console.error(`Error in Yahoo search for ${query}:`, e);
      return { quotes: [] };
    }
  },
};
