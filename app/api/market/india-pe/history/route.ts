import { NextResponse } from 'next/server';

import { findIndexConfig, normalizeIndexName } from '@/lib/market/indiaIndexes';
import clientPromise from '@/lib/mongodb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Monthly P/E series for one index, read from the same MongoDB document the
 * valuation route writes. This is deliberately a cache read: opening a chart
 * must never trigger another NSE archive scrape.
 */
const MONGO_DB = 'portfolio_tracker';
const MONGO_COLLECTION = 'market_cache';
const MONGO_HISTORY_ID = 'india-pe-monthly-v1';
const MONGO_CONNECT_TIMEOUT_MS = 8_000;
const MONGO_QUERY_TIMEOUT_MS = 4_000;
const HISTORY_MONTHS = 60;
const CACHE_MS = 60 * 60_000;

interface MonthlyPe {
  year: number;
  /** Zero-indexed, matching the stored NSE payload. */
  month: number;
  pe: number;
}

interface StoredHistory {
  _id: string;
  updatedAt: Date;
  monthsFound: number;
  monthly: Record<string, MonthlyPe[]>;
}

interface HistoryPoint {
  month: string;
  pe: number;
}

let storedCache: { monthly: Record<string, MonthlyPe[]>; expiresAt: number } | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

function monthKey(value: { year: number; month: number }): string {
  return `${value.year}-${String(value.month + 1).padStart(2, '0')}`;
}

async function loadStoredHistory(): Promise<Record<string, MonthlyPe[]> | null> {
  const now = Date.now();
  if (storedCache && now < storedCache.expiresAt) return storedCache.monthly;
  if (!clientPromise) return null;

  try {
    const client = await withTimeout(clientPromise, MONGO_CONNECT_TIMEOUT_MS);
    if (!client) return null;

    const doc = await withTimeout(
      client
        .db(MONGO_DB)
        .collection<StoredHistory>(MONGO_COLLECTION)
        .findOne({ _id: MONGO_HISTORY_ID }),
      MONGO_QUERY_TIMEOUT_MS,
    );
    if (!doc?.monthly) return null;

    storedCache = {
      monthly: doc.monthly,
      expiresAt: now + CACHE_MS,
    };
    return doc.monthly;
  } catch (error) {
    console.warn('[india-pe-history] cache read failed:', error);
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');
  if (!key) {
    return NextResponse.json(
      { success: false, error: 'An index key is required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const config = findIndexConfig(key);
  if (!config) {
    return NextResponse.json(
      { success: false, error: 'Unknown index key.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const monthly = await loadStoredHistory();
  if (!monthly) {
    return NextResponse.json(
      { success: false, error: 'Monthly index history is unavailable right now.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const points = monthly[normalizeIndexName(config.nseName)] ?? [];
  const months: HistoryPoint[] = [...points]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .slice(-HISTORY_MONTHS)
    .map((point) => ({ month: monthKey(point), pe: point.pe }));

  return NextResponse.json(
    {
      success: true,
      data: {
        key: config.key,
        name: config.name,
        category: config.category,
        source: 'nse',
        months,
      },
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
      },
    },
  );
}
