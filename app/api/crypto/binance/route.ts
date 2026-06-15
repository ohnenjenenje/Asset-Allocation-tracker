import { NextResponse } from 'next/server';
import { binance } from 'ccxt';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_SECRET;

  if (!apiKey || !secret) {
    return NextResponse.json([]);
  }

  try {
    const exchange = new binance({
      apiKey,
      secret,
      enableRateLimit: true,
    });

    const balance = await exchange.fetchBalance();
    
    // Log detailed balance for diagnostic purposes
    console.log('--- RAW BALANCE STRUCTURE ---');
    console.log('Balance total keys:', balance.total ? Object.keys(balance.total).length : 'No total');
    
    // Fetch all tickers from Binance once to get current prices
    const tickers = await exchange.fetchTickers();
    
    // Aggregate by clean symbol
    const aggregatedBalances: Record<string, number> = {};
    Object.entries(balance.total || {}).forEach(([symbol, qty]) => {
      if (typeof qty === 'number' && qty > 0) {
        let cleanSymbol = symbol;
        if (symbol.startsWith('LD') && symbol.length > 3) {
          cleanSymbol = symbol.substring(2);
        }
        aggregatedBalances[cleanSymbol] = (aggregatedBalances[cleanSymbol] || 0) + qty;
      }
    });

    // Map aggregated balances to crypto assets with prices
    const cryptoAssets = Object.entries(aggregatedBalances)
      .map(([cleanSymbol, qty]) => {
        // Ensure standard USDT pair formatting
        const pair = `${cleanSymbol}/USDT`;
        
        // Get the current price from fetched tickers, fallback to 0
        const currentPrice = tickers[pair]?.last || 0;

        return {
          symbol: pair,
          name: cleanSymbol,
          quantity: qty,
          type: 'CRYPTO',
          currentPrice: currentPrice,
          exchange: 'Binance'
        };
      });

    console.log(`Filtered ${cryptoAssets.length} crypto assets with prices.`);
    return NextResponse.json(cryptoAssets);
  } catch (error: any) {
    // Silently handle errors to prevent breaking the dashboard
    return NextResponse.json([]);
  }
}
