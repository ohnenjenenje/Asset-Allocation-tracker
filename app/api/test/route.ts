import { NextResponse } from 'next/server';
import yahooFinance from 'yahoo-finance2';

const yahoo = new yahooFinance();

export async function GET() {
  try {
    const quote = await yahoo.quote('XRP-USD');
    const inr = await yahoo.quote('INR=X');
    return NextResponse.json({ xrp: quote, inr: inr });
  } catch (e) {
    return NextResponse.json({ error: String(e) });
  }
}
