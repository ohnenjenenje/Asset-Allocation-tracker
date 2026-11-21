import { apiFetch } from '@/src/lib/api/client';

/** OpenAI-compatible message used by the multi-provider proxy. */
export type AgentToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type AgentTextPart = { type: 'text'; text: string };
export type AgentImagePart = {
  type: 'image_url';
  image_url: { url: string };
};
export type AgentContent = string | null | (AgentTextPart | AgentImagePart)[];

export type AgentMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: AgentContent;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
  name?: string;
  /** Provider-specific fields (for example Gemini thought signatures). */
  [key: string]: unknown;
};

export type AgentResponse = {
  message: AgentMessage;
  provider?: string;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
};

export async function sendAgentRequest(
  messages: AgentMessage[],
  options: {
    token?: string | null;
    signal?: AbortSignal;
    provider?: string;
    model?: string;
    supportsVision?: boolean;
  } = {},
): Promise<AgentResponse> {
  return apiFetch<AgentResponse>('/api/agent', {
    method: 'POST',
    body: {
      messages,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.supportsVision !== undefined
        ? { supportsVision: options.supportsVision }
        : {}),
    },
    token: options.token,
    signal: options.signal,
    timeoutMs: 60_000,
  });
}

/** One holding row read from a screenshot. */
export type ExtractionUpdate = {
  assetId?: string;
  symbol?: string;
  name?: string;
  quantity?: number;
  entryPrice?: number;
  manualPrice?: number;
};

/** Compact saved-holding context sent with a screenshot extraction. */
export type ExtractionHolding = {
  assetId?: string;
  symbol?: string;
  name?: string;
  type?: string;
};

export type ScreenshotExtraction = {
  summary: string;
  updates: ExtractionUpdate[];
};

export type ExtractionResponse = {
  extraction: ScreenshotExtraction;
  provider?: string;
  model?: string;
  usage?: AgentResponse['usage'];
};

/**
 * Reads a screenshot without tools and returns structured holding rows.
 * Groq's Qwen handles this reliably, while its tool-call JSON is unreliable.
 */
export async function extractScreenshot(
  image: string,
  options: {
    token?: string | null;
    signal?: AbortSignal;
    provider?: string;
    model?: string;
    text?: string;
    supportsVision?: boolean;
    holdings?: ExtractionHolding[];
  } = {},
): Promise<ExtractionResponse> {
  const parts: (AgentTextPart | AgentImagePart)[] = [];
  const text = options.text?.trim().slice(0, 600);
  if (text) parts.push({ type: 'text', text });
  parts.push({ type: 'image_url', image_url: { url: image } });

  return apiFetch<ExtractionResponse>('/api/agent', {
    method: 'POST',
    body: {
      mode: 'extract',
      messages: [{ role: 'user', content: parts }],
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.supportsVision !== undefined
        ? { supportsVision: options.supportsVision }
        : {}),
      ...(options.holdings?.length ? { holdings: options.holdings } : {}),
    },
    token: options.token,
    signal: options.signal,
    timeoutMs: 60_000,
  });
}
