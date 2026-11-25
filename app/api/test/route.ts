import { NextResponse } from 'next/server';
import { yahooChartQuote } from '@/lib/market/yahoo';

export async function GET() {
  const [xrp, inr] = await Promise.all([
    yahooChartQuote('XRP-USD'),
    yahooChartQuote('INR=X'),
  ]);

  return NextResponse.json({ xrp, inr });
}
