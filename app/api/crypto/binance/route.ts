import { NextResponse } from 'next/server';
import { binance } from 'ccxt';

export const dynamic = 'force-dynamic';

/** Markets that do not exist as `<coin>/USDT` pairs. */
const STABLECOINS = new Set([
  'USDT',
  'USDC',
  'BUSD',
  'FDUSD',
  'TUSD',
  'DAI',
  'USDP',
  'PYUSD',
  'USDD',
  'GUSD',
]);

/** Binance Earn wraps balances in LD<asset>, e.g. LDUSDT. */
const cleanBalanceSymbol = (symbol: string) =>
  symbol.startsWith('LD') && symbol.length > 3 ? symbol.substring(2) : symbol;

interface ExchangeAsset {
  symbol: string;
  name: string;
  quantity: number;
  type: 'CRYPTO' | 'CASH';
  currency: 'USD' | 'INR';
  currentPrice: number;
  entryPrice: number;
  exchange: 'Binance';
}

export async function GET() {
  // Render environment variables are sometimes pasted with a trailing newline,
  // a wrapped second line or an invisible character, which makes Node reject
  // the API key header. Binance keys are printable ASCII, so drop anything else.
  const cleanEnv = (value?: string) => (value ?? '').replace(/[^\x21-\x7E]/g, '');
  const apiKey = cleanEnv(process.env.BINANCE_API_KEY);
  const secret = cleanEnv(process.env.BINANCE_SECRET);

  if (!apiKey || !secret) {
    return NextResponse.json(
      { error: 'Missing Binance API keys in Render Environment' },
      { status: 400 },
    );
  }

  try {
    const exchange = new binance({
      apiKey,
      secret,
      enableRateLimit: true,
    });

    const balance = await exchange.fetchBalance();
    await exchange.loadMarkets();

    // Aggregate Earn/LD balances back into their underlying asset.
    const aggregatedBalances: Record<string, number> = {};
    Object.entries(balance.total || {}).forEach(([symbol, rawQty]) => {
      const qty = Number(rawQty);
      if (!Number.isFinite(qty) || qty <= 0) return;
      const cleanSymbol = cleanBalanceSymbol(symbol).toUpperCase();
      aggregatedBalances[cleanSymbol] = (aggregatedBalances[cleanSymbol] || 0) + qty;
    });

    // Only ask for the markets we actually hold. Fetching every Binance ticker
    // is slow and is the main reason this route used to time out/return zeros.
    const bases = Object.keys(aggregatedBalances);
    const pairs = bases
      .filter((base) => base !== 'INR' && !STABLECOINS.has(base))
      .map((base) => `${base}/USDT`)
      .filter((pair) => Boolean(exchange.markets?.[pair]));

    let tickers: Record<string, { last?: number } | undefined> = {};
    try {
      tickers = pairs.length > 0 ? await exchange.fetchTickers(pairs) : {};
    } catch (error) {
      console.warn('Binance targeted ticker fetch failed, retrying full list:', error);
      tickers = await exchange.fetchTickers();
    }

    const cryptoAssets: ExchangeAsset[] = bases
      .map((base) => {
        const isInr = base === 'INR';
        const isStablecoin = STABLECOINS.has(base);
        const price = isInr || isStablecoin
          ? 1
          : Number(tickers[`${base}/USDT`]?.last) || 0;

        return {
          symbol: isInr ? 'INR' : `${base}-USD`,
          name: base,
          quantity: aggregatedBalances[base],
          type: (isInr ? 'CASH' : 'CRYPTO') as ExchangeAsset['type'],
          currency: (isInr ? 'INR' : 'USD') as ExchangeAsset['currency'],
          currentPrice: price,
          entryPrice: price,
          exchange: 'Binance' as const,
        };
      })
      .sort((a, b) => b.currentPrice * b.quantity - a.currentPrice * a.quantity);

    console.log(`Returning ${cryptoAssets.length} Binance balances (${pairs.length} priced pairs).`);
    return NextResponse.json(cryptoAssets);
  } catch (error: any) {
    console.error('Binance API error:', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Binance request failed' },
      { status: 502 },
    );
  }
}
