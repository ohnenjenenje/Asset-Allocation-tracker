import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');

  if (!symbol) {
    return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
  }

  try {
    const result = await yahooFinance.quoteSummary(symbol, { modules: ['topHoldings'] });
    return NextResponse.json(result.topHoldings || { holdings: [] });
  } catch (error: any) {
    console.error(`Holdings API error for ${symbol}:`, error);
    return NextResponse.json({ error: error.message || 'Failed to fetch holdings' }, { status: 500 });
  }
}
