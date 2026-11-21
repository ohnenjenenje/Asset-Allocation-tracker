import { apiFetch } from '@/src/lib/api/client';

export type AssistantProviderId = 'groq' | 'google' | 'openrouter';

export interface AssistantModel {
  id: string;
  name: string;
  contextWindow?: number;
  free?: boolean;
  supportsTools: boolean;
  /** True when the model accepts image input. */
  supportsVision: boolean;
}

export interface AssistantProvider {
  id: AssistantProviderId;
  name: string;
  models: AssistantModel[];
  error?: string;
}

export interface AssistantCatalog {
  providers: AssistantProvider[];
}

export const PROVIDER_LABELS: Record<AssistantProviderId, string> = {
  groq: 'Groq',
  google: 'Google Gemini',
  openrouter: 'OpenRouter',
};

/** Providers with a configured key, plus the models each one currently offers. */
export async function listAssistantModels(
  token?: string | null,
): Promise<AssistantCatalog> {
  return apiFetch<AssistantCatalog>('/api/agent/models', {
    token,
    timeoutMs: 25_000,
  });
}
