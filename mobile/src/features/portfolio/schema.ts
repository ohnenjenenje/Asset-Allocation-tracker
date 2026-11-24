import { z } from 'zod';

import { CRYPTO_SUBTYPES } from './crypto';

export const ASSET_TYPES = [
  'STOCK',
  'MUTUALFUND',
  'ETF',
  'CRYPTO',
  'GOLD',
  'SILVER',
  'COMMODITY',
  'CASH',
  'DEBT',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  STOCK: 'Stock',
  MUTUALFUND: 'Mutual fund',
  ETF: 'ETF',
  CRYPTO: 'Crypto',
  GOLD: 'Gold',
  SILVER: 'Silver',
  COMMODITY: 'Commodity',
  CASH: 'Cash',
  DEBT: 'Debt',
};

/**
 * Backend documents use several generations of type names. Map them onto the
 * editable form enum instead of silently falling back to STOCK, which would
 * reclassify bonds, crypto and commodities as equity the next time they are
 * saved from the mobile app.
 */
const LEGACY_ASSET_TYPE_ALIASES: Record<string, AssetType> = {
  EQUITY: 'STOCK',
  'MUTUAL FUND': 'MUTUALFUND',
  CRYPTOCURRENCY: 'CRYPTO',
  COMMODITIES: 'COMMODITY',
  BOND: 'DEBT',
  BONDS: 'DEBT',
  'FIXED INCOME': 'DEBT',
};

/** Resolve a stored asset type to a value the edit form can display. */
export function assetTypeForForm(type?: string | null): AssetType {
  const upper = (type ?? '').toUpperCase().trim();
  if ((ASSET_TYPES as readonly string[]).includes(upper)) {
    return upper as AssetType;
  }
  return LEGACY_ASSET_TYPE_ALIASES[upper] ?? 'STOCK';
}

export const CAP_OVERRIDE_OPTIONS = [
  '',
  'Large Cap',
  'Mid Cap',
  'Small Cap',
] as const;

export const LIQUIDITY_OPTIONS = [
  '',
  'Daily',
  'Weekly',
  'Monthly',
  'Illiquid',
] as const;

export const CRYPTO_SUBTYPE_OPTIONS = ['', ...CRYPTO_SUBTYPES] as const;

export const assetFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter the asset name.').max(80, 'Keep the name under 80 characters.'),
  symbol: z
    .string()
    .trim()
    .min(1, 'Enter a ticker or symbol.')
    .max(32, 'Keep the symbol under 32 characters.')
    .transform((value) => value.toUpperCase()),
  type: z.enum(ASSET_TYPES),
  quantity: z.coerce.number().positive('Quantity must be greater than zero.'),
  entryPrice: z.coerce.number().nonnegative('Price cannot be negative.'),
  manualPrice: z
    .union([z.literal(''), z.coerce.number().positive('Price must be greater than zero.')])
    .optional(),
  currency: z.enum(['INR', 'USD']),
  manualSector: z.string().trim().max(60, 'Keep the sector under 60 characters.').optional(),
  manualCap: z.enum(CAP_OVERRIDE_OPTIONS).optional(),
  manualLiquidity: z.enum(LIQUIDITY_OPTIONS).optional(),
  cryptoSubtype: z.enum(CRYPTO_SUBTYPE_OPTIONS).optional(),
  account: z.string().trim().max(40, 'Keep the account name under 40 characters.').optional(),
});

export type AssetFormValues = z.input<typeof assetFormSchema>;
export type AssetFormOutput = z.output<typeof assetFormSchema>;

export interface ValidationResult {
  success: boolean;
  data?: AssetFormOutput;
  errors: Partial<Record<keyof AssetFormValues, string>>;
}

export function validateAssetForm(values: AssetFormValues): ValidationResult {
  const result = assetFormSchema.safeParse(values);
  if (result.success) return { success: true, data: result.data, errors: {} };

  const fieldErrors = result.error.flatten().fieldErrors;
  const errors: Partial<Record<keyof AssetFormValues, string>> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages && messages.length > 0) {
      errors[key as keyof AssetFormValues] = messages[0];
    }
  }
  return { success: false, errors };
}
