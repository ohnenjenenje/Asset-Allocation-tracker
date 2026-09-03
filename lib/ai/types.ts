// DIP: abstraction for AI providers (OCP: add new provider without editing caller)
export interface AiProvider {
  readonly name: 'openrouter' | 'google';
  chat(request: AiChatRequest): Promise<AiChatResponse>;
}

export interface AiChatRequest {
  messages: any[];
  tools?: any[];
  model?: string;
  openRouterKey?: string;
  googleModel?: string;
  availableModels?: any[];
}

export interface AiChatResponse {
  model: string;
  isFallback: boolean;
  choices: { message: any }[];
  error?: any;
}
