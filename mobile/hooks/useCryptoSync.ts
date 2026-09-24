import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import type { Asset, PriceData } from '@/lib/types';
import { fetchBinanceAssets, fetchCoindcxAssets, ExchangeAssetOut } from '@/lib/cryptoExchanges';

export type ExchangeStatus = {
  state: 'idle' | 'connecting' | 'connected' | 'error' | 'cached';
  lastSynced?: number;
  error?: string;
};

type SetPrices = React.Dispatch<React.SetStateAction<Record<string, PriceData>>>;

const KEY_BINANCE_KEY = 'binance_api_key';
const KEY_BINANCE_SECRET = 'binance_secret';
const KEY_COINDCX_KEY = 'coindcx_api_key';
const KEY_COINDCX_SECRET = 'coindcx_secret';

export function useCryptoSync(
  cachedCrypto: any,
  syncToDb: (updates: any) => Promise<void>,
  setPrices: SetPrices,
  enabled: boolean,
) {
  const [binanceAssets, setBinanceAssets] = useState<Asset[]>([]);
  const [coindcxAssets, setCoindcxAssets] = useState<Asset[]>([]);
  const [binanceStatus, setBinanceStatus] = useState<ExchangeStatus>({ state: 'idle' });
  const [coindcxStatus, setCoindcxStatus] = useState<ExchangeStatus>({ state: 'idle' });
  const [hasBinanceKeys, setHasBinanceKeys] = useState(false);
  const [hasCoindcxKeys, setHasCoindcxKeys] = useState(false);

  const applyAssets = (
    data: ExchangeAssetOut[],
    setter: (a: Asset[]) => void,
    exchangeName: 'Binance' | 'CoinDCX',
    setStatus: (s: ExchangeStatus) => void,
  ) => {
    const mapped = data.map((a) => ({
      ...a,
      id: `${exchangeName.toLowerCase()}-${a.name}`,
      entryPrice: 0,
      currency: a.priceCurrency || 'USD',
    })) as Asset[];
    setter(mapped);
    setStatus({ state: 'connected', lastSynced: Date.now() });
    syncToDb({ [`cachedCrypto.${exchangeName.toLowerCase()}`]: { lastSynced: Date.now(), assets: mapped } }).catch(() => {});

    setPrices((prev) => {
      const next = { ...prev };
      data.forEach((crypto) => {
        if (crypto.currentPrice) {
          next[crypto.symbol] = {
            symbol: crypto.symbol,
            regularMarketPrice: crypto.currentPrice,
            currency: crypto.priceCurrency || 'USD',
            shortName: crypto.name,
            quoteType: 'CRYPTO',
            source: `${exchangeName} (device)`,
            lastUpdated: Date.now(),
          };
        }
      });
      return next;
    });
  };

  const syncBinance = useCallback(async () => {
    const apiKey = await SecureStore.getItemAsync(KEY_BINANCE_KEY);
    const secret = await SecureStore.getItemAsync(KEY_BINANCE_SECRET);
    if (!apiKey || !secret) { setBinanceStatus({ state: 'idle' }); setHasBinanceKeys(false); return; }
    setHasBinanceKeys(true);
    setBinanceStatus({ state: 'connecting' });
    try {
      const data = await fetchBinanceAssets(apiKey, secret);
      applyAssets(data, setBinanceAssets, 'Binance', setBinanceStatus);
    } catch (err: any) {
      setBinanceStatus({ state: 'error', error: err?.message || 'Sync failed' });
    }
  }, []);

  const syncCoindcx = useCallback(async () => {
    const apiKey = await SecureStore.getItemAsync(KEY_COINDCX_KEY);
    const secret = await SecureStore.getItemAsync(KEY_COINDCX_SECRET);
    if (!apiKey || !secret) { setCoindcxStatus({ state: 'idle' }); setHasCoindcxKeys(false); return; }
    setHasCoindcxKeys(true);
    setCoindcxStatus({ state: 'connecting' });
    try {
      const data = await fetchCoindcxAssets(apiKey, secret);
      applyAssets(data, setCoindcxAssets, 'CoinDCX', setCoindcxStatus);
    } catch (err: any) {
      setCoindcxStatus({ state: 'error', error: err?.message || 'Sync failed' });
    }
  }, []);

  const saveKeys = async (exchange: 'binance' | 'coindcx', apiKey: string, secret: string) => {
    const [k, s] = exchange === 'binance' ? [KEY_BINANCE_KEY, KEY_BINANCE_SECRET] : [KEY_COINDCX_KEY, KEY_COINDCX_SECRET];
    await SecureStore.setItemAsync(k, apiKey.trim());
    await SecureStore.setItemAsync(s, secret.trim());
    if (exchange === 'binance') await syncBinance();
    else await syncCoindcx();
  };

  const clearKeys = async (exchange: 'binance' | 'coindcx') => {
    const [k, s] = exchange === 'binance' ? [KEY_BINANCE_KEY, KEY_BINANCE_SECRET] : [KEY_COINDCX_KEY, KEY_COINDCX_SECRET];
    await SecureStore.deleteItemAsync(k);
    await SecureStore.deleteItemAsync(s);
    if (exchange === 'binance') { setBinanceAssets([]); setBinanceStatus({ state: 'idle' }); setHasBinanceKeys(false); }
    else { setCoindcxAssets([]); setCoindcxStatus({ state: 'idle' }); setHasCoindcxKeys(false); }
  };

  // Initial sync on login
  useEffect(() => {
    if (!enabled) return;
    syncBinance();
    syncCoindcx();
  }, [enabled, syncBinance, syncCoindcx]);

  // Fallback to cached assets from Firestore on error
  useEffect(() => {
    if (!cachedCrypto) return;
    if (binanceStatus.state === 'error' && cachedCrypto.binance) {
      setBinanceAssets(cachedCrypto.binance.assets.map((a: any) => ({ ...a, id: `cached-binance-${a.name}` })));
      setBinanceStatus({ state: 'cached', lastSynced: cachedCrypto.binance.lastSynced });
    }
    if (coindcxStatus.state === 'error' && cachedCrypto.coindcx) {
      setCoindcxAssets(cachedCrypto.coindcx.assets.map((a: any) => ({ ...a, id: `cached-coindcx-${a.name}` })));
      setCoindcxStatus({ state: 'cached', lastSynced: cachedCrypto.coindcx.lastSynced });
    }
  }, [binanceStatus.state, coindcxStatus.state, cachedCrypto]);

  return {
    binanceAssets, coindcxAssets,
    binanceStatus, coindcxStatus,
    hasBinanceKeys, hasCoindcxKeys,
    syncBinance, syncCoindcx,
    saveKeys, clearKeys,
  };
}
