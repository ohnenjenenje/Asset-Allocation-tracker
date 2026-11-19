import { createHash } from 'node:crypto';

import type { AiProviderId } from './ai-providers';
import clientPromise from './mongodb';

/**
 * Per-key request accounting for the AI key pool.
 *
 * Providers report their quota in response headers. Groq sends
 * `x-ratelimit-*` on every chat response, OpenRouter sends `X-RateLimit-*`
 * when it rejects a request, and Gemini reports quota in the 429 payload
 * without useful headers. We keep our own counter for every key so the app can
 * show real usage even when the provider is silent, and persist the last
 * reported quota so the number survives server restarts.
 *
 * Only a hash of each key is stored, never the key itself. Environment keys
 * are shared by all users, so their counter is shared too.
 */

const DB_NAME = 'portfolio_tracker';
const COLLECTION = 'ai_key_usage';

export interface AiRateLimitSnapshot {
  limitRequests: number | null;
  remainingRequests: number | null;
  resetRequests: string | null;
  limitTokens: number | null;
  remainingTokens: number | null;
  resetTokens: string | null;
  retryAfterSeconds: number | null;
}

export interface AiKeyUsageSummary {
  requests: number;
  successes: number;
  failures: number;
  todayRequests: number;
  lastStatus: number | null;
  lastUsedAt: string | null;
  limitRequests: number | null;
  remainingRequests: number | null;
  resetRequests: string | null;
  limitTokens: number | null;
  remainingTokens: number | null;
  resetTokens: string | null;
  /** True while the provider quota is known to be exhausted. */
  limitReached: boolean;
  /** When the exhausted window is expected to reset, as ISO time. */
  limitResetAt: string | null;
}

interface UsageDocument {
  _id: string;
  provider: AiProviderId;
  requests: number;
  successes: number;
  failures: number;
  day: string;
  dayRequests: number;
  daySuccesses: number;
  dayFailures: number;
  lastStatus: number | null;
  lastStatusAt: Date | null;
  lastUsedAt: Date | null;
  lastError: string | null;
  limitRequests: number | null;
  remainingRequests: number | null;
  resetRequests: string | null;
  limitTokens: number | null;
  remainingTokens: number | null;
  resetTokens: string | null;
  limitReachedUntil: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export function emptyKeyUsage(): AiKeyUsageSummary {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    todayRequests: 0,
    lastStatus: null,
    lastUsedAt: null,
    limitRequests: null,
    remainingRequests: null,
    resetRequests: null,
    limitTokens: null,
    remainingTokens: null,
    resetTokens: null,
    limitReached: false,
    limitResetAt: null,
  };
}

/** Stable, non-reversible id so counters can be stored without the key. */
export function keyUsageId(provider: AiProviderId, secret: string): string {
  const digest = createHash('sha256')
    .update(`${provider}:${secret}`)
    .digest('hex')
    .slice(0, 32);
  return `${provider}:${digest}`;
}

function utcDay(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MongoDB timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function usageCollection() {
  if (!clientPromise) return null;
  const client = await withTimeout(clientPromise, 4_000);
  return client.db(DB_NAME).collection<UsageDocument>(COLLECTION);
}

function headerNumber(headers: Headers, ...names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw == null || raw.trim() === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function headerString(headers: Headers, ...names: string[]): string | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw != null && raw.trim() !== '') return raw.trim();
  }
  return null;
}

function retryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (!raw || !raw.trim()) return null;

  const numeric = Number(raw.trim());
  if (Number.isFinite(numeric) && numeric >= 0) return numeric;

  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }
  return null;
}

/**
 * Reads the quota snapshot attached to a provider response. Groq uses the
 * specific `*-requests`/`*-tokens` names; OpenRouter uses the generic names on
 * rate-limit errors.
 */
export function rateLimitSnapshot(response: Response): AiRateLimitSnapshot | null {
  const headers = response.headers;
  const snapshot: AiRateLimitSnapshot = {
    limitRequests: headerNumber(headers, 'x-ratelimit-limit-requests', 'x-ratelimit-limit'),
    remainingRequests: headerNumber(
      headers,
      'x-ratelimit-remaining-requests',
      'x-ratelimit-remaining',
    ),
    resetRequests: headerString(headers, 'x-ratelimit-reset-requests', 'x-ratelimit-reset'),
    limitTokens: headerNumber(headers, 'x-ratelimit-limit-tokens'),
    remainingTokens: headerNumber(headers, 'x-ratelimit-remaining-tokens'),
    resetTokens: headerString(headers, 'x-ratelimit-reset-tokens'),
    retryAfterSeconds: retryAfterSeconds(headers),
  };

  return Object.values(snapshot).some((value) => value != null) ? snapshot : null;
}

const DURATION_TOKEN = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/gi;

/** Parses Groq's duration strings ("1m26.4s") or an absolute reset time. */
function resetToMilliseconds(raw: string | null, now: number): number | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    // Values above 1e12 are epoch milliseconds; above 1e9 are epoch seconds.
    if (numeric > 1e12) return Math.max(0, numeric - now);
    if (numeric > 1e9) return Math.max(0, numeric * 1000 - now);
    return Math.max(0, numeric * 1000);
  }

  const parsedDate = Date.parse(value);
  if (Number.isFinite(parsedDate)) return Math.max(0, parsedDate - now);

  DURATION_TOKEN.lastIndex = 0;
  let total = 0;
  let matched = false;
  for (const match of value.matchAll(DURATION_TOKEN)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multiplier =
      unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    total += amount * multiplier;
  }
  return matched ? Math.max(0, total) : null;
}

/**
 * Groq and Gemini put the real wait in the error text, for example
 * "Please try again in 7m12.96s" or "Please retry in 10.2s".
 */
function messageResetMs(message: string, now: number): number | null {
  if (!message) return null;
  const match = message.match(
    /(?:try again|retry)(?:\s+again)?\s+in\s+((?:\d+(?:\.\d+)?\s*(?:ms|s|m|h|d)\s*)+)/i,
  );
  return match ? resetToMilliseconds(match[1], now) : null;
}

function exhaustedResetMs(snapshot: AiRateLimitSnapshot | null, now: number): number | null {
  const resets: number[] = [];
  if (snapshot?.remainingRequests === 0) {
    const ms = resetToMilliseconds(snapshot.resetRequests, now);
    if (ms != null) resets.push(ms);
  }
  if (snapshot?.remainingTokens === 0) {
    const ms = resetToMilliseconds(snapshot.resetTokens, now);
    if (ms != null) resets.push(ms);
  }
  return resets.length > 0 ? Math.max(...resets) : null;
}

function limitReachedUntil(
  status: number,
  snapshot: AiRateLimitSnapshot | null,
  message: string,
  now: number,
): Date | null | undefined {
  if (status === 429) {
    const retryMs =
      snapshot?.retryAfterSeconds != null ? snapshot.retryAfterSeconds * 1000 : null;
    const knownResets = [
      resetToMilliseconds(snapshot?.resetRequests ?? null, now),
      resetToMilliseconds(snapshot?.resetTokens ?? null, now),
    ].filter((value): value is number => value != null);
    const fallbackMs = knownResets.length > 0 ? Math.min(...knownResets) : null;
    const waitMs = Math.max(
      1_000,
      retryMs ??
        messageResetMs(message, now) ??
        exhaustedResetMs(snapshot, now) ??
        fallbackMs ??
        60_000,
    );
    return new Date(now + waitMs);
  }

  // A successful request can still be the last one in the current window.
  if (status >= 200 && status < 300) {
    const exhaustedMs = exhaustedResetMs(snapshot, now);
    if (exhaustedMs != null) return new Date(now + exhaustedMs);
    if (snapshot?.remainingRequests === 0 || snapshot?.remainingTokens === 0) {
      // Quota is empty but the provider did not say when it resets.
      return new Date(now + 60_000);
    }

    // The key answered, so any older exhausted state no longer applies.
    return null;
  }

  // Keep a previous 429 state across unrelated failures.
  return undefined;
}

/**
 * Records one request to a provider key. Fire-and-forget: usage accounting must
 * never delay or fail a chat request.
 */
export async function recordKeyResponse(
  provider: AiProviderId,
  secret: string,
  status: number,
  message: string,
  response?: Response,
): Promise<void> {
  if (!clientPromise) return;

  try {
    const collection = await usageCollection();
    if (!collection) return;

    const id = keyUsageId(provider, secret);
    const now = new Date();
    const day = utcDay(now);
    const ok = status >= 200 && status < 300;
    const snapshot = response ? rateLimitSnapshot(response) : null;

    // Roll the daily counters when the UTC day changes. Groq and OpenRouter
    // both reset their daily windows at 00:00 UTC.
    await collection.updateOne(
      { _id: id, day: { $ne: day } },
      { $set: { day, dayRequests: 0, daySuccesses: 0, dayFailures: 0 } },
    );

    const set: Record<string, unknown> = {
      provider,
      day,
      lastStatus: status,
      lastStatusAt: now,
      lastUsedAt: now,
      lastError: ok ? null : message.slice(0, 300),
      updatedAt: now,
    };

    if (snapshot) {
      if (snapshot.limitRequests != null) set.limitRequests = snapshot.limitRequests;
      if (snapshot.remainingRequests != null) set.remainingRequests = snapshot.remainingRequests;
      if (snapshot.resetRequests != null) set.resetRequests = snapshot.resetRequests;
      if (snapshot.limitTokens != null) set.limitTokens = snapshot.limitTokens;
      if (snapshot.remainingTokens != null) set.remainingTokens = snapshot.remainingTokens;
      if (snapshot.resetTokens != null) set.resetTokens = snapshot.resetTokens;
    }

    const reachedUntil = limitReachedUntil(status, snapshot, message, now.getTime());
    if (reachedUntil !== undefined) set.limitReachedUntil = reachedUntil;

    const update = {
      $inc: {
        requests: 1,
        dayRequests: 1,
        ...(ok
          ? { successes: 1, daySuccesses: 1 }
          : { failures: 1, dayFailures: 1 }),
      },
      $set: set,
      $setOnInsert: { createdAt: now },
    };

    try {
      await collection.updateOne({ _id: id }, update, { upsert: true });
    } catch (error: any) {
      // Two concurrent first requests can race on the upsert.
      if (error?.code !== 11000) throw error;
      await collection.updateOne({ _id: id }, update);
    }
  } catch (error: any) {
    console.warn('[AI usage] Could not record a key request:', error?.message || error);
  }
}

function toSummary(doc: UsageDocument | null | undefined): AiKeyUsageSummary {
  if (!doc) return emptyKeyUsage();

  const resetAt =
    doc.limitReachedUntil instanceof Date && !Number.isNaN(doc.limitReachedUntil.getTime())
      ? doc.limitReachedUntil
      : null;
  const now = Date.now();
  const today = utcDay();
  const todayRequests =
    doc.day === today ? Math.max(0, Number(doc.dayRequests) || 0) : 0;

  return {
    requests: Math.max(0, Number(doc.requests) || 0),
    successes: Math.max(0, Number(doc.successes) || 0),
    failures: Math.max(0, Number(doc.failures) || 0),
    todayRequests,
    lastStatus: typeof doc.lastStatus === 'number' ? doc.lastStatus : null,
    lastUsedAt:
      doc.lastUsedAt instanceof Date ? doc.lastUsedAt.toISOString() : null,
    limitRequests: typeof doc.limitRequests === 'number' ? doc.limitRequests : null,
    remainingRequests:
      typeof doc.remainingRequests === 'number' ? doc.remainingRequests : null,
    resetRequests: typeof doc.resetRequests === 'string' ? doc.resetRequests : null,
    limitTokens: typeof doc.limitTokens === 'number' ? doc.limitTokens : null,
    remainingTokens:
      typeof doc.remainingTokens === 'number' ? doc.remainingTokens : null,
    resetTokens: typeof doc.resetTokens === 'string' ? doc.resetTokens : null,
    limitReached: resetAt != null && resetAt.getTime() > now,
    limitResetAt: resetAt ? resetAt.toISOString() : null,
  };
}

/** Usage summaries keyed by `keyUsageId`. Returns an empty map on failure. */
export async function getKeyUsageMap(
  entries: Array<{ provider: AiProviderId; key: string }>,
): Promise<Map<string, AiKeyUsageSummary>> {
  const result = new Map<string, AiKeyUsageSummary>();
  if (!clientPromise || entries.length === 0) return result;

  const ids = [...new Set(entries.map((entry) => keyUsageId(entry.provider, entry.key)))];
  if (ids.length === 0) return result;

  try {
    const collection = await usageCollection();
    if (!collection) return result;
    const docs = await collection.find({ _id: { $in: ids } }).toArray();
    for (const doc of docs) result.set(doc._id, toSummary(doc));
  } catch (error: any) {
    console.warn('[AI usage] Could not read key usage:', error?.message || error);
  }

  return result;
}
