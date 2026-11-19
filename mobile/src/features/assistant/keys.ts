import { apiFetch } from '@/src/lib/api/client';

import type { AssistantProviderId } from './models';

export type AiKeySource = 'account' | 'environment';

/** Per-key request counter and the provider's last reported quota. */
export interface AiKeyUsage {
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
  limitReached: boolean;
  limitResetAt: string | null;
}

export const EMPTY_KEY_USAGE: AiKeyUsage = {
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

export interface AiKeyEntry {
  id: string;
  label: string;
  masked: string;
  source: AiKeySource;
  provider: AssistantProviderId;
  createdAt: string | null;
  lastUsedAt: string | null;
  status: 'active' | 'cooling';
  cooldownSeconds: number;
  /** Optional so an older server response still renders. */
  usage?: AiKeyUsage;
}

export interface AiKeysResponse {
  keys: AiKeyEntry[];
  maxKeys: number;
  environmentKeyCount: number;
}

export async function listAiKeys(token?: string | null): Promise<AiKeysResponse> {
  return apiFetch<AiKeysResponse>('/api/agent/keys', {
    token,
    timeoutMs: 15_000,
  });
}

export async function addAiKey(
  token: string | null | undefined,
  key: string,
  label?: string,
): Promise<{ key: AiKeyEntry; maxKeys: number }> {
  return apiFetch<{ key: AiKeyEntry; maxKeys: number }>('/api/agent/keys', {
    method: 'POST',
    body: { key, label },
    token,
    timeoutMs: 30_000,
  });
}

export async function deleteAiKey(
  token: string | null | undefined,
  id: string,
): Promise<{ deleted: boolean }> {
  return apiFetch<{ deleted: boolean }>(
    `/api/agent/keys?id=${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      token,
      timeoutMs: 15_000,
    },
  );
}
