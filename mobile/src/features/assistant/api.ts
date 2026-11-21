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
export type AgentContent = string | null | Array<AgentTextPart | AgentImagePart>;

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
  } = {},
): Promise<AgentResponse> {
  return apiFetch<AgentResponse>('/api/agent', {
    method: 'POST',
    body: {
      messages,
      ...(options.provider ? { provider: options.provider } : {}),
      ...(options.model ? { model: options.model } : {}),
    },
    token: options.token,
    signal: options.signal,
    timeoutMs: 60_000,
  });
}
