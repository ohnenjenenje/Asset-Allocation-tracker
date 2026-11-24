import { assetTypeForForm, validateAssetForm } from '../schema';

describe('assetTypeForForm', () => {
  it('keeps types that are already editable', () => {
    expect(assetTypeForForm('STOCK')).toBe('STOCK');
    expect(assetTypeForForm('GOLD')).toBe('GOLD');
    expect(assetTypeForForm('COMMODITY')).toBe('COMMODITY');
  });

  it('maps legacy backend type names onto the form enum', () => {
    expect(assetTypeForForm('EQUITY')).toBe('STOCK');
    expect(assetTypeForForm('CRYPTOCURRENCY')).toBe('CRYPTO');
    expect(assetTypeForForm('FIXED INCOME')).toBe('DEBT');
    expect(assetTypeForForm('COMMODITIES')).toBe('COMMODITY');
  });

  it('is case-insensitive and falls back to stock for unknown values', () => {
    expect(assetTypeForForm('commodity')).toBe('COMMODITY');
    expect(assetTypeForForm('unrecognised')).toBe('STOCK');
    expect(assetTypeForForm(undefined)).toBe('STOCK');
  });
});

describe('crypto subtype form field', () => {
  const base = {
    name: 'Dogecoin',
    symbol: 'DOGE-USD',
    type: 'CRYPTO' as const,
    quantity: '1000',
    entryPrice: '0.08',
    currency: 'USD' as const,
    manualPrice: '',
  };

  it('accepts each explicit crypto subtype', () => {
    for (const subtype of [
      'Bitcoin',
      'Ethereum',
      'Stablecoins',
      'Memecoins',
      'Other Crypto',
    ] as const) {
      const result = validateAssetForm({ ...base, cryptoSubtype: subtype });
      expect(result.success).toBe(true);
      expect(result.data?.cryptoSubtype).toBe(subtype);
    }
  });

  it('keeps Auto and rejects free-text buckets', () => {
    const auto = validateAssetForm({ ...base, cryptoSubtype: '' });
    expect(auto.success).toBe(true);
    expect(auto.data?.cryptoSubtype).toBe('');

    const invalid = validateAssetForm({
      ...base,
      cryptoSubtype: 'Dog coins' as never,
    });
    expect(invalid.success).toBe(false);
    expect(invalid.errors.cryptoSubtype).toBeDefined();
  });
});
