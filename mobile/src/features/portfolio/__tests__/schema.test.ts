import { assetTypeForForm } from '../schema';

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
