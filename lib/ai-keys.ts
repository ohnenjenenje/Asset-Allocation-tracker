import { createHash, randomUUID } from 'node:crypto';

import {
  AI_PROVIDER_ORDER,
  detectProvider,
  environmentKeysFor,
  providerDefinition,
  validateProviderKey,
  type AiProviderId,
} from './ai-providers';
import {
  emptyKeyUsage,
  getKeyUsageMap,
  keyUsageId,
  type AiKeyUsageSummary,
} from './ai-key-usage';
import clientPromise from './mongodb';

/**
 * Multi-provider AI key pool with per-user storage and smart rotation.
 *
 * Keys can come from two places:
 *  - server environment variables (for example `GROQ_API_KEYS`)
 *  - a signed-in user's account, added through `/api/agent/keys`
 *
 * Each key belongs to a provider. Selection is least-recently-used with a
 * round-robin offset, so free-tier keys share the load instead of exhausting
 * one at a time. Keys that return 429/401/403/5xx are put on a short cooldown
 * and the request moves to the next key. Full keys are never sent to the
 * client; only masked values are.
 *
 * Older documents have no `provider` field; they are treated as Groq keys so
 * existing installs keep working.
 */

const DB_NAME = 'portfolio_tracker';
const KEYS_COLLECTION = 'user_ai_keys';

export const MAX_USER_KEYS = 10;

export type AgentKeySource = 'account' | 'environment';

export interface AgentKey {
  id: string;
  key: string;
  label: string;
  source: AgentKeySource;
  provider: AiProviderId;
  /** Cooldown persisted by another server instance, as epoch milliseconds. */
  cooldownUntil?: number;
}

export interface StoredAiKey {
  uid: string;
  keyId: string;
  key: string;
  label: string;
  provider?: AiProviderId;
  createdAt: Date;
  lastUsedAt?: Date | null;
  cooldownUntil?: Date | null;
  failureCount?: number;
  successCount?: number;
  lastError?: string | null;
}

export interface KeyEntry {
  id: string;
  label: string;
  masked: string;
  source: AgentKeySource;
  provider: AiProviderId;
  createdAt: string | null;
  lastUsedAt: string | null;
  status: 'active' | 'cooling';
  cooldownSeconds: number;
  /** Request counter and the provider's last reported quota for this key. */
  usage: AiKeyUsageSummary;
}

export interface KeyListResult {
  keys: KeyEntry[];
  maxKeys: number;
  environmentKeyCount: number;
}

interface RuntimeState {
  cooldownUntil: number;
  lastUsedAt: number;
  failures: number;
}

const runtime = new Map<string, RuntimeState>();
let rotationCursor = 0;

const COOLDOWN_RATE_LIMIT_MS = 60 * 1000;
const COOLDOWN_AUTH_MS = 30 * 60 * 1000;
const COOLDOWN_SERVER_MS = 30 * 1000;
const COOLDOWN_TIMEOUT_MS = 20 * 1000;

function fingerprint(secret: string): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

function runtimeState(key: string): RuntimeState {
  const id = fingerprint(key);
  let state = runtime.get(id);
  if (!state) {
    state = { cooldownUntil: 0, lastUsedAt: 0, failures: 0 };
    runtime.set(id, state);
  }
  return state;
}

export function maskAiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 10) {
    return `${trimmed.slice(0, 2)}…${trimmed.slice(-2)}`;
  }
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
}

/** Environment keys for one provider, de-duplicated and trimmed. */
export function environmentAgentKeys(provider: AiProviderId): AgentKey[] {
  return environmentKeysFor(provider).map((value, index) => {
    const definition = providerDefinition(provider);
    return {
      id: `env-${provider}-${index + 1}`,
      key: value,
      label: `${definition.shortName} server key ${index + 1}`,
      source: 'environment' as const,
      provider,
    };
  });
}

function storedProvider(doc: StoredAiKey): AiProviderId {
  return doc.provider && AI_PROVIDER_ORDER.includes(doc.provider) ? doc.provider : 'groq';
}

async function keysCollection() {
  if (!clientPromise) return null;
  const client = await clientPromise;
  return client.db(DB_NAME).collection<StoredAiKey>(KEYS_COLLECTION);
}

async function storedKeyDocs(uid: string): Promise<StoredAiKey[]> {
  const collection = await keysCollection();
  if (!collection) return [];
  return collection.find({ uid }).sort({ createdAt: 1 }).limit(MAX_USER_KEYS + 5).toArray();
}

async function updateStoredKey(
  uid: string,
  keyId: string,
  update: Record<string, unknown>,
): Promise<void> {
  const collection = await keysCollection();
  if (!collection) return;
  await collection.updateOne({ uid, keyId }, update);
}

function effectiveCooldown(key: AgentKey): number {
  return Math.max(runtimeState(key.key).cooldownUntil, key.cooldownUntil ?? 0);
}

export function agentKeyCooldownRemaining(key: AgentKey): number {
  return Math.max(0, effectiveCooldown(key) - Date.now());
}

/**
 * Rate limits are persisted per key so an environment key that hit its quota
 * stays parked after a server restart, not just for the lifetime of this
 * process.
 */
async function applyPersistedLimitCooldowns(keys: AgentKey[]): Promise<AgentKey[]> {
  if (keys.length === 0) return keys;

  try {
    const usage = await getKeyUsageMap(
      keys.map((key) => ({ provider: key.provider, key: key.key })),
    );
    if (usage.size === 0) return keys;

    const now = Date.now();
    return keys.map((key) => {
      const resetAt = usage.get(keyUsageId(key.provider, key.key))?.limitResetAt;
      const until = resetAt ? Date.parse(resetAt) : NaN;
      if (!Number.isFinite(until) || until <= now) return key;
      if (until <= effectiveCooldown(key)) return key;
      return { ...key, cooldownUntil: until };
    });
  } catch {
    return keys;
  }
}

/** Account keys for one provider, then environment keys as a shared fallback. */
export async function getAgentKeyPool(uid: string, provider: AiProviderId): Promise<AgentKey[]> {
  let stored: StoredAiKey[] = [];
  try {
    stored = await storedKeyDocs(uid);
  } catch (error: any) {
    console.warn('[AGENT] Could not load account AI keys:', error?.message || error);
  }

  const accountKeys: AgentKey[] = stored
    .filter((doc) => typeof doc.key === 'string' && doc.key.length >= 20)
    .filter((doc) => storedProvider(doc) === provider)
    .map((doc) => ({
      id: doc.keyId,
      key: doc.key,
      label: doc.label || 'Personal key',
      source: 'account',
      provider,
      cooldownUntil: doc.cooldownUntil ? new Date(doc.cooldownUntil).getTime() : undefined,
    }));

  // The same key can be present in both places (for example when a user adds
  // the server key to their account). Try it once, account entry first.
  const seen = new Set<string>();
  const pool = [...accountKeys, ...environmentAgentKeys(provider)].filter((key) => {
    if (seen.has(key.key)) return false;
    seen.add(key.key);
    return true;
  });

  return applyPersistedLimitCooldowns(pool);
}

/**
 * Account keys are preferred over the shared server pool. Within each tier the
 * order is least-recently-used with a rotating tie-breaker, so free-tier keys
 * share load. Keys still in cooldown are appended last so the caller can skip
 * them without losing the ordering of healthy keys.
 */
export function orderAgentKeys(keys: AgentKey[]): AgentKey[] {
  if (keys.length === 0) return [];

  // Rotate first so equal `lastUsedAt` values (all keys fresh after a server
  // restart) still produce a round-robin order. The stable sort below then
  // puts genuinely least-recently-used keys ahead.
  const offset = rotationCursor % keys.length;
  rotationCursor = (rotationCursor + 1) % keys.length;
  const rotated = [...keys.slice(offset), ...keys.slice(0, offset)];

  const now = Date.now();
  const byRecentUse = (a: AgentKey, b: AgentKey) =>
    runtimeState(a.key).lastUsedAt - runtimeState(b.key).lastUsedAt;

  const accountAvailable = rotated
    .filter((key) => key.source === 'account' && effectiveCooldown(key) <= now)
    .sort(byRecentUse);
  const environmentAvailable = rotated
    .filter((key) => key.source === 'environment' && effectiveCooldown(key) <= now)
    .sort(byRecentUse);
  const cooling = rotated
    .filter((key) => effectiveCooldown(key) > now)
    .sort((a, b) => effectiveCooldown(a) - effectiveCooldown(b));

  return [...accountAvailable, ...environmentAvailable, ...cooling];
}

export function markKeyUsed(uid: string, key: AgentKey): void {
  runtimeState(key.key).lastUsedAt = Date.now();
  if (key.source === 'account') {
    void updateStoredKey(uid, key.id, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  }
}

function cooldownForStatus(status: number, failures: number): number {
  // Consecutive failures escalate the rest period, so a key that has hit its
  // daily quota is not retried on every request. The reset on success below
  // keeps transient failures from sticking.
  const backoff = Math.min(2 ** Math.max(0, failures - 1), 8);

  if (status === 429) {
    return Math.min(COOLDOWN_RATE_LIMIT_MS * backoff, 15 * 60 * 1000);
  }
  if (status === 401 || status === 403) return COOLDOWN_AUTH_MS;
  if (status === 408) return COOLDOWN_TIMEOUT_MS;
  if (status >= 500) {
    return Math.min(COOLDOWN_SERVER_MS * backoff, 5 * 60 * 1000);
  }
  return 0;
}

export function markKeyFailure(
  uid: string,
  key: AgentKey,
  status: number,
  message: string,
): void {
  const state = runtimeState(key.key);
  const now = Date.now();
  state.failures += 1;

  const cooldownMs = cooldownForStatus(status, state.failures);
  const cooldownUntil = cooldownMs > 0 ? now + cooldownMs : 0;

  state.lastUsedAt = now;
  if (cooldownUntil > state.cooldownUntil) state.cooldownUntil = cooldownUntil;

  if (key.source === 'account') {
    const set: Record<string, unknown> = {
      lastUsedAt: new Date(now),
      lastError: message.slice(0, 300),
    };
    if (cooldownUntil > 0) set.cooldownUntil = new Date(cooldownUntil);
    void updateStoredKey(uid, key.id, {
      $set: set,
      $inc: { failureCount: 1 },
    }).catch(() => {});
  }
}

export function markKeySuccess(uid: string, key: AgentKey): void {
  const state = runtimeState(key.key);
  state.cooldownUntil = 0;
  state.failures = 0;
  state.lastUsedAt = Date.now();

  if (key.source === 'account') {
    void updateStoredKey(uid, key.id, {
      $set: { lastUsedAt: new Date(), lastError: null, cooldownUntil: null },
      $inc: { successCount: 1 },
    }).catch(() => {});
  }
}

function toEntry(
  key: AgentKey,
  usage?: AiKeyUsageSummary,
  createdAt?: Date | null,
): KeyEntry {
  const remaining = agentKeyCooldownRemaining(key);
  return {
    id: key.id,
    label: key.label,
    masked: maskAiKey(key.key),
    source: key.source,
    provider: key.provider,
    createdAt: createdAt ? createdAt.toISOString() : null,
    lastUsedAt: usage?.lastUsedAt ?? null,
    status: remaining > 0 ? 'cooling' : 'active',
    cooldownSeconds: Math.ceil(remaining / 1000),
    usage: usage ?? emptyKeyUsage(),
  };
}

export async function listKeyEntries(uid: string): Promise<KeyListResult> {
  const stored = await storedKeyDocs(uid);

  const accountKeys = stored
    .filter((doc) => typeof doc.key === 'string' && doc.key.length > 0)
    .map((doc) => {
      const provider = storedProvider(doc);
      const key: AgentKey = {
        id: doc.keyId,
        key: doc.key,
        label: doc.label || 'Personal key',
        source: 'account',
        provider,
        cooldownUntil: doc.cooldownUntil ? new Date(doc.cooldownUntil).getTime() : undefined,
      };
      return { doc, key };
    });

  const environment = AI_PROVIDER_ORDER.flatMap((provider) => environmentAgentKeys(provider));
  const usage = await getKeyUsageMap(
    [...accountKeys.map(({ key }) => key), ...environment].map((key) => ({
      provider: key.provider,
      key: key.key,
    })),
  );

  const accountEntries = accountKeys.map(({ doc, key }) => {
    const entry = toEntry(key, usage.get(keyUsageId(key.provider, key.key)), doc.createdAt);
    if (!entry.lastUsedAt && doc.lastUsedAt) {
      entry.lastUsedAt = new Date(doc.lastUsedAt).toISOString();
    }
    return entry;
  });

  return {
    keys: [
      ...accountEntries,
      ...environment.map((key) =>
        toEntry(key, usage.get(keyUsageId(key.provider, key.key))),
      ),
    ],
    maxKeys: MAX_USER_KEYS,
    environmentKeyCount: environment.length,
  };
}

export type AddKeyResult =
  | { ok: true; entry: KeyEntry }
  | { ok: false; status: number; error: string };

export async function addStoredAiKey(
  uid: string,
  provider: AiProviderId,
  rawKey: string,
  label?: string,
): Promise<AddKeyResult> {
  const collection = await keysCollection();
  if (!collection) {
    return {
      ok: false,
      status: 503,
      error: 'Key storage is not configured on the server (MONGODB_URI is missing).',
    };
  }

  const key = rawKey.trim();
  const duplicate = await collection.findOne({ uid, key });
  if (duplicate) {
    return { ok: false, status: 409, error: 'That key is already added.' };
  }

  const count = await collection.countDocuments({ uid });
  if (count >= MAX_USER_KEYS) {
    return {
      ok: false,
      status: 409,
      error: `You can store up to ${MAX_USER_KEYS} keys. Remove one before adding another.`,
    };
  }

  const now = new Date();
  const definition = providerDefinition(provider);
  const doc: StoredAiKey = {
    uid,
    keyId: randomUUID(),
    key,
    provider,
    label: (label?.trim() || `${definition.shortName} key ${count + 1}`).slice(0, 40),
    createdAt: now,
    lastUsedAt: null,
    cooldownUntil: null,
    failureCount: 0,
    successCount: 0,
    lastError: null,
  };

  await collection.insertOne(doc);

  const keyEntry = toEntry(
    { id: doc.keyId, key: doc.key, label: doc.label, source: 'account', provider },
    undefined,
    doc.createdAt,
  );
  return { ok: true, entry: keyEntry };
}

export async function deleteStoredAiKey(uid: string, keyId: string): Promise<boolean> {
  const collection = await keysCollection();
  if (!collection) return false;
  const result = await collection.deleteOne({ uid, keyId });
  return result.deletedCount > 0;
}

/** Confirms a key is active before storing it. */
export async function validateAiKey(
  provider: AiProviderId,
  key: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return validateProviderKey(provider, key);
}

/** Best-effort provider detection used when the client does not send one. */
export function providerForNewKey(key: string, requested?: unknown): AiProviderId | null {
  if (requested === 'groq' || requested === 'google' || requested === 'openrouter') {
    return requested;
  }
  return detectProvider(key);
}
