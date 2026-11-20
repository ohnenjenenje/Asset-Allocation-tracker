import {
  isAssetSearchReady,
  mapSearchResult,
  normalizeSearchResults,
  type AssetSearchResult,
} from '../searchResults';

function result(overrides: Partial<AssetSearchResult>): AssetSearchResult {
  return { symbol: 'TEST.NS', ...overrides };
}

describe('normalizeSearchResults', () => {
  it('drops malformed rows, trims values and deduplicates symbols', () => {
    const normalized = normalizeSearchResults([
      { symbol: ' RELIANCE.NS ', shortname: ' Reliance Industries ', quoteType: 'EQUITY' },
      { symbol: 'RELIANCE.NS', shortname: 'Duplicate' },
      { symbol: '', shortname: 'Missing symbol' },
      null,
      'not-an-object',
      { symbol: 'TCS.NS', longname: 'Tata Consultancy Services' },
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized[0]).toEqual({
      symbol: 'RELIANCE.NS',
      shortname: 'Reliance Industries',
      longname: undefined,
      quoteType: 'EQUITY',
      source: undefined,
    });
    expect(normalized[1].symbol).toBe('TCS.NS');
  });

  it('returns an empty list for a non-array payload', () => {
    expect(normalizeSearchResults({ error: 'nope' })).toEqual([]);
  });

  it('caps the result list', () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      symbol: `ASSET${index}.NS`,
    }));
    expect(normalizeSearchResults(rows)).toHaveLength(8);
  });
});

describe('mapSearchResult', () => {
  it('maps an Indian equity to a stock with INR', () => {
    expect(
      mapSearchResult(
        result({
          symbol: 'RELIANCE.NS',
          shortname: 'Reliance Industries',
          quoteType: 'EQUITY',
        }),
      ),
    ).toEqual({
      name: 'Reliance Industries',
      symbol: 'RELIANCE.NS',
      type: 'STOCK',
      currency: 'INR',
    });
  });

  it('maps crypto and US futures to USD', () => {
    expect(mapSearchResult(result({ symbol: 'BTC-USD', quoteType: 'CRYPTOCURRENCY' }))).toMatchObject({
      type: 'CRYPTO',
      currency: 'USD',
    });
    expect(mapSearchResult(result({ symbol: 'GC=F', quoteType: 'FUTURE' }))).toMatchObject({
      type: 'GOLD',
      currency: 'USD',
    });
  });

  it('maps physical gold, silver and cash symbols to their asset types', () => {
    expect(mapSearchResult(result({ symbol: 'GOLD-INR-GRAM', quoteType: 'COMMODITY' })).type).toBe(
      'GOLD',
    );
    expect(mapSearchResult(result({ symbol: 'SILVER-INR-GRAM', quoteType: 'COMMODITY' })).type).toBe(
      'SILVER',
    );
    expect(mapSearchResult(result({ symbol: 'CASH-INR', quoteType: 'CASH' })).type).toBe('CASH');
  });

  it('maps funds, ETFs and debt instruments', () => {
    expect(mapSearchResult(result({ symbol: 'MF_120503', quoteType: 'MUTUALFUND' })).type).toBe(
      'MUTUALFUND',
    );
    expect(mapSearchResult(result({ symbol: 'NIFTYBEES.NS', quoteType: 'ETF' })).type).toBe('ETF');
    expect(mapSearchResult(result({ symbol: 'BOND1.NS', quoteType: 'FIXED INCOME' })).type).toBe(
      'DEBT',
    );
  });

  it('falls back to the symbol when no name is supplied', () => {
    expect(mapSearchResult(result({ symbol: 'tcs.ns' }))).toMatchObject({
      name: 'TCS.NS',
      symbol: 'TCS.NS',
      type: 'STOCK',
    });
  });
});

describe('isAssetSearchReady', () => {
  it('requires at least two non-space characters', () => {
    expect(isAssetSearchReady('')).toBe(false);
    expect(isAssetSearchReady(' r ')).toBe(false);
    expect(isAssetSearchReady('re')).toBe(true);
    expect(isAssetSearchReady(' reli ')).toBe(true);
  });
});
