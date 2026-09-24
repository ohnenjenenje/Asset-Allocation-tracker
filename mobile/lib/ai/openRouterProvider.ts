import { apiFetch } from '../api';

import { AiProvider, AiChatRequest, AiChatResponse } from './types';

// SRP: handles OpenRouter tool calling + fallback logic
export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter' as const;

  constructor(private openRouterKey: string, private availableModels: any[]) {}

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const { messages, tools, model, availableModels } = request;
    let currentModel = model!;
    const originalModel = model!;
    let isFallback = false;

    let res = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: currentModel, messages, tools, key: this.openRouterKey }),
    });

    if (!res.ok && availableModels && availableModels.length > 0 && (currentModel.includes(':free') || currentModel === 'meta-llama/llama-3.3-70b-instruct:free')) {
      let err: any;
      try { err = JSON.parse(await res.clone().text()); } catch {}
      const isRateLimited = err?.error?.code === 429 || err?.error?.message?.includes('429') || err?.error?.message?.includes('rate limit') || err?.error?.metadata?.raw?.includes('rate-limited');
      if (isRateLimited) {
        const fallbackModels = availableModels.filter((m: any) => m.id !== currentModel).slice(0, 3);
        for (const fallback of fallbackModels) {
          const fallbackRes = await apiFetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: fallback.id, messages, tools, key: this.openRouterKey }),
          });
          if (fallbackRes.ok) { res = fallbackRes; currentModel = fallback.id; isFallback = true; break; }
        }
        if (!isFallback) currentModel = originalModel;
      }
    }

    if (!res.ok) {
      const text = await res.text();
      let err: any;
      try { err = JSON.parse(text); } catch { err = { error: { message: `Server error (${res.status}): ${text.substring(0, 100)}` } }; }
      let msg = err.error?.message || 'Failed to call OpenRouter';
      const raw = err.error?.metadata?.raw || '';
      if (msg.includes('guardrail')) msg = 'The selected free model requires data logging. Please enable data collection at https://openrouter.ai/settings/privacy or select a different model.';
      else if (err.error?.code === 429 || msg.includes('requires more credits') || msg.includes('429') || msg.includes('rate limit') || raw.includes('rate-limited')) msg = `The selected model (${originalModel}) and all available free fallback models are currently rate-limited. Please try again or switch to Google Gemini.`;
      else if (msg.includes('Provider returned error') || msg.includes('upstream error')) msg = `The selected AI model (${currentModel}) is currently experiencing issues. Please select a different model.`;
      throw new Error(msg);
    }

    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return { ...data, model: currentModel, isFallback };
    } catch {
      if (text.trim().startsWith('<')) throw new Error(`Server returned HTML error: ${text.substring(0, 100)}`);
      throw new Error(`Invalid JSON from server: ${text.substring(0, 100)}`);
    }
  }
}
