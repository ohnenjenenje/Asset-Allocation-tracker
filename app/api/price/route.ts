import { NextResponse } from 'next/server';
import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbolsParam = searchParams.get('symbols');

  if (!symbolsParam) {
    return NextResponse.json({ error: 'Query parameter "symbols" is required' }, { status: 400 });
  }

  try {
    const symbols = symbolsParam.split(',').map(s => s.trim()).filter(Boolean);
    const quotes = await yahooFinance.quote(symbols) as any;
    
    // yahooFinance.quote returns an array if multiple symbols, or a single object if one symbol.
    const results = Array.isArray(quotes) ? quotes : [quotes];
    return NextResponse.json(results);
  } catch (error: any) {
    console.error('Price API error:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch data' }, { status: 500 });
  }
}
