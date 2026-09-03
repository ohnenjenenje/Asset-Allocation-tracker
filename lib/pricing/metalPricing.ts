import {
  GOLD_IMPORT_DUTY_PERCENT,
  GST_PERCENT,
  TROY_OUNCE_IN_GRAMS,
  USDINR_FALLBACK,
} from '@/lib/constants';

// SRP: isolates precious-metal pricing logic (previously duplicated in price route + tax-utils)
export function calculateMetalPricePerGramInr(
  priceUsdPerTroyOunce: number,
  usdToInr: number = USDINR_FALLBACK,
): number {
  let pricePerGramInr = (priceUsdPerTroyOunce / TROY_OUNCE_IN_GRAMS) * usdToInr;
  const duty = GOLD_IMPORT_DUTY_PERCENT / 100;
  const gst = GST_PERCENT / 100;
  pricePerGramInr *= (1 + duty) * (1 + gst);
  return pricePerGramInr;
}
