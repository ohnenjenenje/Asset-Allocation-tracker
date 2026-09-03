import { AiProvider, AiChatRequest, AiChatResponse } from './types';

// SRP: isolates Gemini protocol translation; DIP: client no longer depends on GoogleGenAI directly, goes through server route
export class GeminiProvider implements AiProvider {
  readonly name = 'google' as const;

  constructor(private googleModel: string) {}

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const { messages, tools } = request;
    const res = await fetch('/api/gemini', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, tools, model: this.googleModel }),
    });
    if (!res.ok) {
      const text = await res.text();
      let err: any;
      try { err = JSON.parse(text); } catch { err = { error: { message: text.substring(0, 200) } }; }
      throw new Error(err.error?.message || `Gemini API error ${res.status}`);
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || 'Gemini error');
    return data as AiChatResponse;
  }
}
