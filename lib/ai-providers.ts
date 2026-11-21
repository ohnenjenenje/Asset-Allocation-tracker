import { createHash } from 'node:crypto';

/**
 * Provider registry for the mobile AI assistant.
 *
 * Every provider speaks the OpenAI chat-completions dialect, so the proxy can
 * keep one request/response shape while the picker exposes exactly the models
 * the configured keys can reach. Model lists are fetched from the provider and
 * cached briefly; nothing is hardcoded except defaults and filters.
 */

export type AiProviderId = 'groq' | 'google' | 'openrouter';

export interface AiProviderDefinition {
  id: AiProviderId;
  name: string;
  shortName: string;
  /** Key prefixes used to recognise a pasted key. */
  keyPrefixes: string[];
  /** Environment variables that can hold one or more keys. */
  envKeyNames: string[];
  modelsUrl: string;
  chatUrl: string;
  /** Default when the client does not send a model. */
  defaultModel: string;
  /** Optional endpoint used only to check whether a key is valid. */
  validateUrl?: string;
}

export interface AiModel {
  id: string;
  name: string;
  contextWindow?: number;
  free?: boolean;
  supportsTools: boolean;
  /** True when the model accepts image input (needed for screenshot import). */
  supportsVision: boolean;
}

export interface AiProviderModels {
  id: AiProviderId;
  name: string;
  models: AiModel[];
  error?: string;
}

const PROVIDERS: Record<AiProviderId, AiProviderDefinition> = {
  groq: {
    id: 'groq',
    name: 'Groq',
    shortName: 'Groq',
    keyPrefixes: ['gsk_'],
    envKeyNames: ['GROQ_API_KEYS', 'GROQ_API_KEY'],
    modelsUrl: 'https://api.groq.com/openai/v1/models',
    chatUrl: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    shortName: 'Gemini',
    keyPrefixes: ['AIza'],
    envKeyNames: [
      'GEMINI_API_KEYS',
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY',
      'GOOGLE_GENERATIVE_AI_API_KEY',
      'NEXT_PUBLIC_GEMINI_API_KEY',
    ],
    modelsUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
    chatUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-2.5-flash',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    shortName: 'OpenRouter',
    keyPrefixes: ['sk-or-v1-'],
    envKeyNames: ['OPENROUTER_API_KEYS', 'OPENROUTER_API_KEY'],
    modelsUrl: 'https://openrouter.ai/api/v1/models',
    chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-4o-mini',
    validateUrl: 'https://openrouter.ai/api/v1/key',
  },
};

export const AI_PROVIDER_IDS = Object.keys(PROVIDERS) as AiProviderId[];

/** Display order in the picker. Groq stays first to match the existing setup. */
export const AI_PROVIDER_ORDER: AiProviderId[] = ['groq', 'google', 'openrouter'];

export function providerDefinition(id: AiProviderId): AiProviderDefinition {
  return PROVIDERS[id];
}

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

export function detectProvider(key: string): AiProviderId | null {
  const trimmed = key.trim();
  for (const id of AI_PROVIDER_ORDER) {
    if (PROVIDERS[id].keyPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
      return id;
    }
  }
  return null;
}

/** Splits comma-separated env values into unique, plausibly non-empty keys. */
export function environmentKeysFor(provider: AiProviderId): string[] {
  const definition = PROVIDERS[provider];
  const raw = definition.envKeyNames.flatMap((name) => (process.env[name] || '').split(','));
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const candidate of raw) {
    const value = candidate.trim();
    if (value.length < 20 || seen.has(value)) continue;
    seen.add(value);
    keys.push(value);
  }

  return keys;
}

const MODEL_CACHE_MS = 10 * 60 * 1000;
const modelCache = new Map<string, { expiresAt: number; models: AiModel[] }>();

function cacheKey(provider: AiProviderId, key: string): string {
  return createHash('sha256').update(`${provider}:${key}`).digest('hex').slice(0, 24);
}

function nonChatModel(id: string): boolean {
  // These are speech, image, safety or otherwise non-tool models that the
  // provider lists next to its chat models. The assistant needs tool calling,
  // so a model without it would only produce failed requests.
  return /(whisper|tts|orpheus|allam|guard|moderation|embed|rerank|aqa|lyria|veo|imagen|image|audio|transcribe|live|robotics|computer-use|deep-research|antigravity|nano-banana)/i.test(
    id,
  );
}

function titleizeModelName(id: string): string {
  const base = id.split('/').pop() || id;
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bOss\b/g, 'OSS')
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bLlm\b/g, 'LLM')
    .replace(/\bMoe\b/g, 'MoE');
}

function supportsTools(entry: any): boolean {
  const parameters = Array.isArray(entry?.supported_parameters)
    ? (entry.supported_parameters as unknown[])
    : [];
  if (parameters.length === 0) return true;
  return parameters.includes('tools') || parameters.includes('tool_choice');
}

/**
 * Vision capability.
 *
 * OpenRouter publishes `architecture.input_modalities`; the other providers
 * only expose a model list, so their IDs have to identify multimodal models.
 * Erring on the side of "no" hides the screenshot button instead of sending an
 * image to a text-only model and failing at request time.
 */
function supportsVision(provider: AiProviderId, entry: any, id: string): boolean {
  const modalities = Array.isArray(entry?.architecture?.input_modalities)
    ? (entry.architecture.input_modalities as unknown[])
    : Array.isArray(entry?.input_modalities)
      ? (entry.input_modalities as unknown[])
      : [];
  if (modalities.length > 0) return modalities.includes('image');

  if (provider === 'google') {
    // Gemini 1.5 and newer are natively multimodal.
    return /^gemini-(1\.5|2(?:\.|$)|3(?:\.|$))/i.test(id);
  }

  if (provider === 'groq') {
    return /(vision|llava|pixtral|llama-4-(scout|maverick)|gemma-3|qwen[^/]*vl)/i.test(id);
  }

  return /(vision|gpt-4o|gpt-4\.1|gpt-5|claude-(3|4)|gemini|llama-4|pixtral|llava|qwen[^/]*vl|internvl|mistral-small-3)/i.test(
    id,
  );
}

function normalizeModel(provider: AiProviderId, entry: any): AiModel | null {
  if (!entry || typeof entry.id !== 'string') return null;

  let id = entry.id.trim();
  if (!id || id.length > 200) return null;
  // Gemini's native model resource names are `models/gemini-…`; the
  // OpenAI-compatible chat endpoint expects the bare model ID.
  if (provider === 'google' && id.startsWith('models/')) id = id.slice('models/'.length);
  if (provider === 'google' && !/^gemini-/i.test(id)) return null;
  if (nonChatModel(id)) return null;

  const contextWindow =
    typeof entry.context_window === 'number'
      ? entry.context_window
      : typeof entry.context_length === 'number'
        ? entry.context_length
        : undefined;

  const promptPrice = entry?.pricing?.prompt;
  const free =
    entry?.pricing?.prompt === '0' ||
    entry?.pricing?.completion === '0' ||
    (typeof promptPrice === 'string' && Number(promptPrice) === 0);

  const tools = supportsTools(entry);
  const vision = supportsVision(provider, entry, id);

  return {
    id,
    name: typeof entry.name === 'string' && entry.name.trim() ? entry.name : titleizeModelName(id),
    ...(contextWindow ? { contextWindow } : {}),
    ...(free ? { free: true } : {}),
    supportsTools: tools,
    supportsVision: vision,
  };
}

function sortModels(provider: AiProviderId, models: AiModel[]): AiModel[] {
  const preferred = provider === 'groq' ? PROVIDERS.groq.defaultModel : null;
  return models.sort((a, b) => {
    if (preferred) {
      if (a.id === preferred) return -1;
      if (b.id === preferred) return 1;
    }
    if (Boolean(b.free) !== Boolean(a.free)) return a.free ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function fetchModels(provider: AiProviderId, key: string): Promise<AiModel[]> {
  const definition = PROVIDERS[provider];
  const response = await fetch(definition.modelsUrl, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`The provider returned HTTP ${response.status} while listing models.`);
  }

  const payload: any = await response.json();
  const entries: unknown[] = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload)
        ? payload
        : [];

  const models: AiModel[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (provider === 'groq' && (entry as any)?.active === false) continue;
    if (
      provider === 'google' &&
      Array.isArray((entry as any)?.supportedGenerationMethods) &&
      !(entry as any).supportedGenerationMethods.includes('generateContent')
    ) {
      continue;
    }

    const model = normalizeModel(provider, entry);
    if (!model || seen.has(model.id)) continue;
    // OpenRouter exposes the whole catalogue. Keep tool-capable chat models,
    // which is what this assistant needs.
    if (provider === 'openrouter' && !model.supportsTools) continue;
    seen.add(model.id);
    models.push(model);
  }

  if (models.length === 0) {
    throw new Error('The provider did not return any chat models for this key.');
  }

  return sortModels(provider, models);
}

/** Model list for a provider, cached per key so opening the picker is cheap. */
export async function listModelsForProvider(
  provider: AiProviderId,
  key: string,
): Promise<AiModel[]> {
  const cacheId = cacheKey(provider, key);
  const cached = modelCache.get(cacheId);
  if (cached && cached.expiresAt > Date.now()) return cached.models;

  const models = await fetchModels(provider, key);
  modelCache.set(cacheId, { expiresAt: Date.now() + MODEL_CACHE_MS, models });
  return models;
}

export function clearModelCache(): void {
  modelCache.clear();
}

export type KeyValidation = { ok: true } | { ok: false; error: string };

/** Pulls a readable message out of the different provider error envelopes. */
export function providerErrorMessage(payload: any, fallback = ''): string {
  const candidates = [
    payload?.error?.message,
    typeof payload?.error === 'string' ? payload.error : undefined,
    Array.isArray(payload) ? payload[0]?.error?.message : undefined,
    Array.isArray(payload)
      ? typeof payload[0]?.error === 'string'
        ? payload[0].error
        : undefined
      : undefined,
    payload?.message,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.replace(/\s+/g, ' ').trim();
    }
  }

  return fallback.replace(/\s+/g, ' ').trim();
}

export async function validateProviderKey(
  provider: AiProviderId,
  key: string,
): Promise<KeyValidation> {
  const definition = PROVIDERS[provider];

  try {
    const response = await fetch(definition.validateUrl || definition.modelsUrl, {
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });

    // A 429 still means the key exists; it is just busy.
    if (response.status === 429) return { ok: true };
    if (!response.ok) {
      const text = await response.text();
      let payload: any = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
      const detail = providerErrorMessage(payload, text);

      if (response.status === 401 || response.status === 403) {
        // A 403 is not always a bad key: Gemini returns one when the project
        // has no billing or API access enabled. Explain that instead of
        // telling the user to replace a valid key.
        const accessProblem = /billing|free tier|quota|permission|not available|not enabled/i.test(
          detail,
        );
        return {
          ok: false,
          error: accessProblem
            ? `${definition.name} accepted the key, but the project cannot use the API: ${detail.slice(0, 300)}`
            : `${definition.name} rejected this key. Check that it is active and copied correctly.`,
        };
      }

      return {
        ok: false,
        error: `${definition.name} returned HTTP ${response.status} while checking the key. Try again.`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: `Could not reach ${definition.name} to verify the key. Try again in a moment.`,
    };
  }
}

export function chatHeaders(
  provider: AiProviderId,
  key: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://portfolio-tracker-hjvx.onrender.com';
    headers['X-Title'] = 'Asset Allocation Tracker';
  }

  return headers;
}

export function chatRequestBody(
  provider: AiProviderId,
  model: string,
  messages: unknown[],
  tools: unknown[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    tools,
    tool_choice: 'auto',
  };

  // Groq and OpenRouter accept the newer token-limit field; Gemini's OpenAI
  // compatibility layer documents max_tokens.
  if (provider === 'google') {
    body.max_tokens = 1600;
  } else {
    body.max_completion_tokens = 1600;
  }

  return body;
}

export function sanitizeModelId(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,199}$/.test(trimmed)) return '';
  return trimmed;
}

export function defaultModelFor(provider: AiProviderId): string {
  return PROVIDERS[provider].defaultModel;
}

/**
 * Rejects a model that the provider's live catalogue does not contain. If the
 * catalogue cannot be loaded we let the provider decide instead of blocking
 * chat on a discovery failure.
 */
export async function modelIsAvailable(
  provider: AiProviderId,
  model: string,
  key: string,
): Promise<boolean> {
  try {
    const models = await listModelsForProvider(provider, key);
    return models.some((entry) => entry.id === model);
  } catch {
    return true;
  }
}
