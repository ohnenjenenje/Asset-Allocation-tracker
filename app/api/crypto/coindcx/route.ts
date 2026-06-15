import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiKey = process.env.COINDCX_API_KEY;
  const secret = process.env.COINDCX_SECRET;

  if (!apiKey || !secret) {
    return NextResponse.json({ error: 'Missing keys', keyLen: apiKey?.length, secretLen: secret?.length });
  }

  try {
    const timeStamp = Math.floor(Date.now());
    const body = { timestamp: timeStamp };
    const payload = JSON.stringify(body);
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const balanceRes = await fetch('https://api.coindcx.com/exchange/v1/users/balances', {
      method: 'POST',
      headers: {
        'X-AUTH-APIKEY': apiKey,
        'X-AUTH-SIGNATURE': signature,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    });

    if (!balanceRes.ok) {
        throw new Error(`API Error: ${balanceRes.status} ${balanceRes.statusText}`);
    }

    const balances = await balanceRes.json();
    
    // Fetch tickers for getting prices
    const tickerRes = await fetch('https://api.coindcx.com/exchange/ticker');
    const tickers = await tickerRes.json();
    
    const cryptoAssets = [];
    
    if (Array.isArray(balances)) {
      for (const balance of balances) {
        const qty = parseFloat(balance.balance);
        if (qty > 0) {
          const symbol = balance.currency;
          
          let currentPrice = 0;
          const pair = `${symbol}USDT`;
          const inrPair = `${symbol}INR`;
          
          if (Array.isArray(tickers)) {
              const usdtTicker = tickers.find((t: any) => t.market === pair);
              const inrTicker = tickers.find((t: any) => t.market === inrPair);
              
              if (usdtTicker && usdtTicker.last_price) {
                  currentPrice = parseFloat(usdtTicker.last_price);
              } else if (inrTicker && inrTicker.last_price) {
                  currentPrice = parseFloat(inrTicker.last_price) / 83; // Estimate
              }
          }
          
          cryptoAssets.push({
            symbol: symbol === 'INR' ? 'INR' : `${symbol}/USDT`,
            name: symbol,
            quantity: qty,
            type: 'CRYPTO',
            currentPrice: currentPrice,
            exchange: 'CoinDCX'
          });
        }
      }
    }

    return NextResponse.json(cryptoAssets);
  } catch (error: any) {
    console.error('CoinDCX API Error:', error);
    return NextResponse.json({ error: error.message });
  }
}
