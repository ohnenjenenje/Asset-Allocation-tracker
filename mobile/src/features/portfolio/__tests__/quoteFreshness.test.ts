import {
  describeStaleQuotes,
  oldestStaleQuoteAsOf,
  type StaleQuote,
} from '../quoteFreshness';

// Mid-morning UTC keeps the timestamp on 19 August in every common timezone.
const NOW = Date.UTC(2026, 10, 26, 12);
const AUG_19 = Date.UTC(2026, 7, 19, 6);

function quote(overrides: Partial<StaleQuote> = {}): StaleQuote {
  return {
    symbol: 'HDFC.NS',
    name: 'HDFC Flexi Cap',
    assetId: 'asset-1',
    asOf: AUG_19,
    ...overrides,
  };
}

describe('describeStaleQuotes', () => {
  it('names a single cached holding and its last quote date', () => {
    expect(describeStaleQuotes([quote()], NOW)).toBe(
      'HDFC Flexi Cap is using a cached price from 19 Aug because a live quote was unavailable.',
    );
  });

  it('names two holdings without repeating the count', () => {
    expect(
      describeStaleQuotes(
        [
          quote(),
          quote({
            symbol: 'AXIS.NS',
            name: 'Axis Small Cap',
            assetId: 'asset-2',
          }),
        ],
        NOW,
      ),
    ).toBe(
      'HDFC Flexi Cap and Axis Small Cap are using cached prices from 19 Aug because live quotes were unavailable.',
    );
  });

  it('summarizes the rest when several holdings are cached', () => {
    expect(
      describeStaleQuotes(
        [
          quote(),
          quote({ name: 'Axis Small Cap' }),
          quote({ name: 'Parag Parikh Flexi Cap' }),
        ],
        NOW,
      ),
    ).toBe(
      'HDFC Flexi Cap and 2 other holdings are using cached prices from 19 Aug because live quotes were unavailable.',
    );
  });

  it('omits the date when the cached quote has no timestamp', () => {
    expect(describeStaleQuotes([quote({ asOf: null })], NOW)).toBe(
      'HDFC Flexi Cap is using a cached price because a live quote was unavailable.',
    );
  });
});

describe('oldestStaleQuoteAsOf', () => {
  it('ignores missing timestamps', () => {
    expect(
      oldestStaleQuoteAsOf([
        quote({ asOf: NOW }),
        quote({ asOf: null }),
        quote({ asOf: AUG_19 }),
      ]),
    ).toBe(AUG_19);
    expect(oldestStaleQuoteAsOf([quote({ asOf: null })])).toBeNull();
  });
});
