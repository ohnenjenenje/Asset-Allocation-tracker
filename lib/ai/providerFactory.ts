import { AiProvider } from './types';
import { OpenRouterProvider } from './openRouterProvider';
import { GeminiProvider } from './geminiProvider';

export function createAiProvider(opts: {
  aiProvider: 'openrouter' | 'google';
  openRouterKey: string;
  availableModels: any[];
  googleModel: string;
}): AiProvider {
  if (opts.aiProvider === 'google') return new GeminiProvider(opts.googleModel);
  return new OpenRouterProvider(opts.openRouterKey, opts.availableModels);
}
