// SRP: single responsibility - symbol classification
// OCP: add new symbol types by extending helpers, not editing core handlers

export const isMutualFundSymbol = (symbol: string): boolean => {
  const s = (symbol || '').toUpperCase();
  return (
    s.startsWith('0P') ||
    /^\d+$/.test(s) ||
    s.startsWith('MF_') ||
    /^INF[A-Z0-9]{9}$/i.test(s)
  );
};

export const isGoldSilverSymbol = (symbol: string): boolean =>
  symbol === 'GOLD-INR-GRAM' || symbol === 'SILVER-INR-GRAM';

export const isIndianSymbol = (symbol: string): boolean =>
  symbol.endsWith('.NS') || symbol.endsWith('.BO') || isGoldSilverSymbol(symbol);

export const isUsdAsset = (symbol: string): boolean => {
  const isMF = isMutualFundSymbol(symbol);
  return symbol.endsWith('-USD') || (!symbol.includes('.') && !isMF && !isGoldSilverSymbol(symbol));
};

export const getGFinanceSymbol = (symbol: string): string => {
  if (symbol === 'INR=X') return 'CURRENCY:USDINR';
  if (symbol.endsWith('=X')) return `CURRENCY:USD${symbol.replace('=X', '')}`;
  if (symbol.endsWith('.NS')) return `NSE:${symbol.replace('.NS', '')}`;
  if (symbol.endsWith('.BO') && !symbol.startsWith('0P')) return `BSE:${symbol.replace('.BO', '')}`;
  if (symbol.includes('-')) return `CURRENCY:${symbol.replace('-', '')}`;
  return symbol;
};
