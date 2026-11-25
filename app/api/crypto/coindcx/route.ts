import { NextResponse } from 'next/server';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

/** Markets that do not exist as `<coin>USDT` pairs. */
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

interface ExchangeAsset {
  symbol: string;
  name: string;
  quantity: number;
  type: 'CRYPTO' | 'CASH';
  currency: 'USD' | 'INR';
  currentPrice: number;
  entryPrice: number;
  exchange: 'CoinDCX';
}

export async function GET() {
  const cleanEnv = (value?: string) => (value ?? '').replace(/[^\x21-\x7E]/g, '');
  const apiKey = cleanEnv(process.env.COINDCX_API_KEY);
  const secret = cleanEnv(process.env.COINDCX_SECRET);

  if (!apiKey || !secret) {
    return NextResponse.json(
      { error: 'Missing CoinDCX API keys', keyLen: apiKey?.length, secretLen: secret?.length },
      { status: 400 },
    );
  }

  try {
    const timeStamp = Date.now();
    const payload = JSON.stringify({ timestamp: timeStamp });
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

    const balanceRes = await fetch('https://api.coindcx.com/exchange/v1/users/balances', {
      method: 'POST',
      headers: {
        'X-AUTH-APIKEY': apiKey,
        'X-AUTH-SIGNATURE': signature,
        'Content-Type': 'application/json',
      },
      body: payload,
      cache: 'no-store',
    });

    if (!balanceRes.ok) {
      const detail = await balanceRes.text().catch(() => '');
      throw new Error(
        `CoinDCX balance API error: ${balanceRes.status} ${balanceRes.statusText}${detail ? ` — ${detail.substring(0, 160)}` : ''}`,
      );
    }

    const balances = await balanceRes.json();
    if (!Array.isArray(balances)) {
      throw new Error('CoinDCX returned an unexpected balance payload');
    }

    // Tickers are public and let us value both USDT and INR pairs.
    const tickerRes = await fetch('https://api.coindcx.com/exchange/ticker', {
      cache: 'no-store',
    });
    if (!tickerRes.ok) {
      throw new Error(`CoinDCX ticker API error: ${tickerRes.status}`);
    }
    const tickers = await tickerRes.json();
    const byMarket = new Map<string, any>();
    if (Array.isArray(tickers)) {
      for (const ticker of tickers) {
        if (ticker?.market) byMarket.set(ticker.market, ticker);
      }
    }
    const usdToInr = Number(byMarket.get('USDTINR')?.last_price) || 0;

    const cryptoAssets: ExchangeAsset[] = [];

    for (const balance of balances) {
      const quantity =
        (parseFloat(balance?.balance) || 0) + (parseFloat(balance?.locked_balance) || 0);
      if (!(quantity > 0)) continue;

      const base = String(balance?.currency || '').toUpperCase();
      if (!base) continue;

      const isInr = base === 'INR';
      const isStablecoin = STABLECOINS.has(base);

      let price = 0;
      if (isInr || isStablecoin) {
        price = 1;
      } else {
        const usdtTicker = byMarket.get(`${base}USDT`);
        const inrTicker = byMarket.get(`${base}INR`);
        if (usdtTicker?.last_price) {
          price = parseFloat(usdtTicker.last_price) || 0;
        } else if (inrTicker?.last_price && usdToInr > 0) {
          price = (parseFloat(inrTicker.last_price) || 0) / usdToInr;
        }
      }

      cryptoAssets.push({
        symbol: isInr ? 'INR' : `${base}-USD`,
        name: base,
        quantity,
        type: (isInr ? 'CASH' : 'CRYPTO') as ExchangeAsset['type'],
        currency: (isInr ? 'INR' : 'USD') as ExchangeAsset['currency'],
        currentPrice: isInr ? 1 : price,
        entryPrice: isInr ? 1 : price,
        exchange: 'CoinDCX',
      });
    }

    cryptoAssets.sort(
      (a, b) => b.currentPrice * b.quantity - a.currentPrice * a.quantity,
    );

    return NextResponse.json(cryptoAssets);
  } catch (error: any) {
    console.error('CoinDCX API Error:', error?.message || error);
    const detail = String(error?.message || 'CoinDCX request failed');
    const authFailure = /401|invalid credentials|expired|unauthori[sz]ed/i.test(detail);
    let egressIp = '';
    let hint = '';

    if (authFailure) {
      // CoinDCX made API-key IP binding mandatory in October 2026. The key is
      // only valid from the bound address, so tell the operator which address
      // this server actually calls from. Best-effort: the credential hint is
      // still useful when the lookup fails.
      try {
        const ipRes = await fetch('https://api.ipify.org?format=json', {
          cache: 'no-store',
          signal: AbortSignal.timeout(4_000),
        });
        if (ipRes.ok) {
          const body = await ipRes.json().catch(() => null);
          if (body && typeof body.ip === 'string') egressIp = body.ip;
        }
      } catch {
        // Ignore: the IP is a diagnostic aid, not required for the response.
      }

      hint = ` CoinDCX requires API keys to be IP-bound. ${
        egressIp ? `This server calls out from ${egressIp}. ` : ''
      }Create a new key bound to that IP, then update COINDCX_API_KEY and COINDCX_SECRET in Render.`;
    }

    return NextResponse.json(
      { error: `${detail}${hint}`, egressIp: egressIp || undefined },
      { status: 502 },
    );
  }
}
