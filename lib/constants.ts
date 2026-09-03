export const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7300'];

// --- FX & Pricing constants (SRP: single source of truth, DIP: dependents invert to these) ---
export const USDINR_FALLBACK = 83;
export const GBP_TO_INR_APPROX = 105;

// Precious metals conversion & tax surcharges (duplicated between tax-utils & price route)
export const TROY_OUNCE_IN_GRAMS = 31.1034768;
export const GOLD_IMPORT_DUTY_PERCENT = 15;
export const GST_PERCENT = 3;

// Yahoo / MFAPI symbols
export const MANUAL_MAP: Record<string, string> = {
  '0P0001S0S9.BO': '152156', // Zerodha Nifty LargeMidcap 250
  '0P0000XW0K.BO': '140196', // Edelweiss Liquid Fund - Direct Growth
  '0P0011MAX.BO': '120503',  // Axis Small Cap Fund
  'MF_101762': '118955',    // HDFC Flexi Cap Fund - Direct Growth
  '0P0000XV5G.BO': '140243', // Edelweiss Greater China - Direct
  '0P0000KYO9.BO': '140242', // Edelweiss Greater China - Regular
  'JPPOWER.BO': 'JPPOWER.NS',
};

// Cache TTLs
export const SHEET_CACHE_TTL_MS = 30_000;
export const MF_LIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Market-cap thresholds (USD)
export const LARGE_CAP_USD = 10_000_000_000;
export const MID_CAP_USD = 2_000_000_000;

// Price sheet header
export const SHEET_HEADER = ['Symbol', 'Price', 'Name', 'Currency', 'Type', 'MarketCap', 'YahooSymbol', 'Sector', 'Source'] as const;
