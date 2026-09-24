import CryptoJS from 'crypto-js';
import { USDINR_FALLBACK } from './constants';

export type ExchangeAssetOut = {
  symbol: string;
  name: string;
  quantity: number;
  type: 'CRYPTO';
  currentPrice: number;
  priceCurrency: 'USD' | 'INR';
  exchange: 'Binance' | 'CoinDCX';
};

const hmacSha256Hex = (message: string, secret: string) =>
  CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Hex);

// ---------------- Binance ----------------
const BINANCE_BASES = ['https://api.binance.com', 'https://api.binance.me', 'https://api.binance.info'];

export async function fetchBinanceAssets(apiKey: string, secret: string): Promise<ExchangeAssetOut[]> {
  const timestamp = Date.now();
  const query = `timestamp=${timestamp}&recvWindow=10000`;
  const signature = hmacSha256Hex(query, secret);

  let accountData: any = null;
  let lastErr: any = null;
  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(`${base}/api/v3/account?${query}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey },
      });
      if (!res.ok) {
        const body = await res.text();
        lastErr = new Error(`Binance ${res.status}: ${body.substring(0, 120)}`);
        // Auth errors won't be fixed by another host
        if (res.status === 401 || res.status === 403) throw lastErr;
        continue;
      }
      accountData = await res.json();
      break;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Binance 4')) throw e;
      lastErr = e;
    }
  }
  if (!accountData) throw lastErr || new Error('Binance unreachable');

  // Aggregate balances (LD prefix = Simple Earn/Lending positions)
  const aggregated: Record<string, number> = {};
  for (const b of accountData.balances || []) {
    const qty = parseFloat(b.free) + parseFloat(b.locked);
    if (qty > 0) {
      let sym = b.asset as string;
      if (sym.startsWith('LD') && sym.length > 3) sym = sym.substring(2);
      aggregated[sym] = (aggregated[sym] || 0) + qty;
    }
  }

  // Prices — public endpoint, no auth
  let tickers: any[] = [];
  for (const base of BINANCE_BASES) {
    try {
      const res = await fetch(`${base}/api/v3/ticker/price`);
      if (res.ok) { tickers = await res.json(); break; }
    } catch {}
  }
  const priceMap: Record<string, number> = {};
  for (const t of tickers) priceMap[t.symbol] = parseFloat(t.price);

  return Object.entries(aggregated).map(([sym, qty]) => {
    const pair = `${sym}/USDT`;
    const currentPrice = priceMap[`${sym}USDT`] || 0;
    return {
      symbol: pair,
      name: sym,
      quantity: qty,
      type: 'CRYPTO' as const,
      currentPrice,
      priceCurrency: 'USD' as const,
      exchange: 'Binance' as const,
    };
  });
}

// ---------------- CoinDCX ----------------
export async function fetchCoindcxAssets(apiKey: string, secret: string): Promise<ExchangeAssetOut[]> {
  const body = { timestamp: Math.floor(Date.now()) };
  const payload = JSON.stringify(body);
  const signature = hmacSha256Hex(payload, secret);

  const balanceRes = await fetch('https://api.coindcx.com/exchange/v1/users/balances', {
    method: 'POST',
    headers: {
      'X-AUTH-APIKEY': apiKey,
      'X-AUTH-SIGNATURE': signature,
      'Content-Type': 'application/json',
    },
    body: payload,
  });
  if (!balanceRes.ok) throw new Error(`CoinDCX API Error: ${balanceRes.status}`);
  const balances = await balanceRes.json();

  const tickerRes = await fetch('https://api.coindcx.com/exchange/ticker');
  const tickers = await tickerRes.json();

  const out: ExchangeAssetOut[] = [];
  if (Array.isArray(balances)) {
    for (const balance of balances) {
      const qty = parseFloat(balance.balance);
      if (qty <= 0) continue;
      const symbol: string = balance.currency;
      let currentPrice = 0;
      if (Array.isArray(tickers)) {
        const usdt = tickers.find((t: any) => t.market === `${symbol}USDT`);
        const inr = tickers.find((t: any) => t.market === `${symbol}INR`);
        if (usdt?.last_price) currentPrice = parseFloat(usdt.last_price);
        else if (inr?.last_price) currentPrice = parseFloat(inr.last_price) / USDINR_FALLBACK;
      }
      out.push({
        symbol: symbol === 'INR' ? 'INR' : `${symbol}/USDT`,
        name: symbol,
        quantity: qty,
        type: 'CRYPTO',
        currentPrice,
        priceCurrency: 'USD',
        exchange: 'CoinDCX',
      });
    }
  }
  return out;
}
