/** @jest-environment node */

import {
  cryptoAllocationPath,
  cryptoBaseSymbol,
  cryptoDisplayName,
  cryptoSubtypeForAsset,
  cryptoSubtypeFromSymbol,
  hasKnownCostBasis,
  normalizeCryptoSubtype,
  STABLECOIN_BASES,
} from '../crypto';
import { normalizeExchangeAsset } from '../normalize';
import type { Asset } from '../types';

function cryptoAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: 'btc',
    symbol: 'BTC-USD',
    name: 'Bitcoin',
    quantity: 1,
    entryPrice: 50_000,
    currency: 'USD',
    type: 'CRYPTO',
    ...overrides,
  };
}

describe('crypto base symbols', () => {
  it('reduces venue quote conventions to the coin', () => {
    expect(cryptoBaseSymbol('BTC')).toBe('BTC');
    expect(cryptoBaseSymbol('btc-usd')).toBe('BTC');
    expect(cryptoBaseSymbol('BTC-INR')).toBe('BTC');
    expect(cryptoBaseSymbol('BTC/USDT')).toBe('BTC');
    expect(cryptoBaseSymbol('BTCUSDT')).toBe('BTC');
    expect(cryptoBaseSymbol('SOLUSDT')).toBe('SOL');
    expect(cryptoBaseSymbol('ETH-BTC')).toBe('ETH');
  });

  it('does not collapse wrapped or derivative tickers into the underlying coin', () => {
    expect(cryptoBaseSymbol('WBTC')).toBe('WBTC');
    expect(cryptoBaseSymbol('WETH')).toBe('WETH');
    expect(cryptoBaseSymbol('BTCUP')).toBe('BTCUP');
  });

  it('keeps stablecoin symbols intact', () => {
    expect(cryptoBaseSymbol('USDT')).toBe('USDT');
    expect(cryptoBaseSymbol('USDC-USD')).toBe('USDC');
    for (const stablecoin of STABLECOIN_BASES) {
      expect(cryptoBaseSymbol(stablecoin)).toBe(stablecoin);
    }
  });
});

describe('crypto subtype inference', () => {
  it('auto-detects only BTC, ETH and the known stablecoin list', () => {
    expect(cryptoSubtypeFromSymbol('BTC-USD')).toBe('Bitcoin');
    expect(cryptoSubtypeFromSymbol('ETH-INR')).toBe('Ethereum');
    expect(cryptoSubtypeFromSymbol('USDT')).toBe('Stablecoins');
    expect(cryptoSubtypeFromSymbol('USDC-USD')).toBe('Stablecoins');
    expect(cryptoSubtypeFromSymbol('DOGE-USD')).toBeNull();
    expect(cryptoSubtypeFromSymbol('SHIB-USD')).toBeNull();
  });

  it('lets an explicit subtype override symbol inference', () => {
    expect(
      cryptoSubtypeForAsset(
        cryptoAsset({ symbol: 'BTC-USD', cryptoSubtype: 'Other Crypto' }),
      ),
    ).toBe('Other Crypto');
    expect(
      cryptoSubtypeForAsset(
        cryptoAsset({ symbol: 'DOGE-USD', cryptoSubtype: 'Memecoins' }),
      ),
    ).toBe('Memecoins');
  });

  it('uses a legacy category path before inferring from the symbol', () => {
    expect(
      cryptoSubtypeForAsset(
        cryptoAsset({ categoryPath: ['Crypto', 'Other Crypto'] }),
      ),
    ).toBe('Other Crypto');
  });

  it('normalises subtype labels from older documents', () => {
    expect(normalizeCryptoSubtype('bitcoin')).toBe('Bitcoin');
    expect(normalizeCryptoSubtype('STABLECOIN')).toBe('Stablecoins');
    expect(normalizeCryptoSubtype('meme coin')).toBeNull();
    expect(normalizeCryptoSubtype('Other Crypto')).toBe('Other Crypto');
  });
});

describe('crypto allocation paths', () => {
  it('maps known coins to their canonical child sleeve', () => {
    expect(cryptoAllocationPath(cryptoAsset())).toBe('Crypto > Bitcoin');
    expect(
      cryptoAllocationPath(cryptoAsset({ symbol: 'ETH-USD', name: 'Ethereum' })),
    ).toBe('Crypto > Ethereum');
    expect(
      cryptoAllocationPath(cryptoAsset({ symbol: 'USDC-USD', name: 'USDC' })),
    ).toBe('Crypto > Stablecoins');
  });

  it('leaves unknown coins directly under Crypto instead of guessing', () => {
    expect(
      cryptoAllocationPath(
        cryptoAsset({ symbol: 'DOGE-USD', name: 'Dogecoin' }),
      ),
    ).toBe('Crypto');
  });

  it('honours an explicit memecoin or other-crypto choice', () => {
    expect(
      cryptoAllocationPath(
        cryptoAsset({ symbol: 'DOGE-USD', cryptoSubtype: 'Memecoins' }),
      ),
    ).toBe('Crypto > Memecoins');
    expect(
      cryptoAllocationPath(
        cryptoAsset({ symbol: 'XYZ-USD', cryptoSubtype: 'Other Crypto' }),
      ),
    ).toBe('Crypto > Other Crypto');
  });

  it('returns null for non-crypto assets', () => {
    expect(
      cryptoAllocationPath(
        cryptoAsset({ type: 'STOCK', symbol: 'HDFCBANK.NS' }),
      ),
    ).toBeNull();
    expect(
      cryptoAllocationPath(
        cryptoAsset({
          type: 'CRYPTO',
          categoryPath: ['Equities', 'Domestic Equity'],
        }),
      ),
    ).toBeNull();
  });

  it('preserves an existing custom crypto sub-path', () => {
    expect(
      cryptoAllocationPath(
        cryptoAsset({ symbol: 'XYZ-USD', categoryPath: ['Crypto', 'Cold Storage'] }),
      ),
    ).toBe('Crypto > Cold Storage');
  });
});

describe('crypto cost basis and display', () => {
  it('distinguishes a real cost basis from an exchange placeholder', () => {
    expect(hasKnownCostBasis(cryptoAsset({ entryPrice: 50_000 }))).toBe(true);
    expect(
      hasKnownCostBasis(
        cryptoAsset({ entryPrice: 70_000, costBasisKnown: false }),
      ),
    ).toBe(false);
    expect(hasKnownCostBasis(cryptoAsset({ entryPrice: 0 }))).toBe(false);
  });

  it('marks exchange crypto lots as unknown but stablecoins as known', () => {
    const bitcoin = normalizeExchangeAsset(
      {
        ...cryptoAsset({ symbol: 'BTC', name: 'BTC', entryPrice: 70_000 }),
        currentPrice: 70_000,
      } as Asset & { currentPrice: number },
      'Binance',
    );
    expect(bitcoin.costBasisKnown).toBe(false);

    const tether = normalizeExchangeAsset(
      {
        ...cryptoAsset({ symbol: 'USDT', name: 'USDT', entryPrice: 1 }),
        currentPrice: 1,
      } as Asset & { currentPrice: number },
      'Binance',
    );
    expect(tether.costBasisKnown).toBe(true);
  });

  it('uses clean display names for consolidated positions', () => {
    expect(cryptoDisplayName('BTC')).toBe('Bitcoin');
    expect(cryptoDisplayName('ETH')).toBe('Ethereum');
    expect(cryptoDisplayName('USDT')).toBe('Tether');
    expect(cryptoDisplayName('DOGE', 'Dogecoin')).toBe('Dogecoin');
    expect(cryptoDisplayName('XYZ')).toBe('XYZ');
  });
});
