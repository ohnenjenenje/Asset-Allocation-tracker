import { NextResponse } from 'next/server';

import { resolveRequestUid } from '@/lib/agent-auth';
import { recordKeyResponse } from '@/lib/ai-key-usage';
import {
  agentKeyCooldownRemaining,
  getAgentKeyPool,
  markKeyFailure,
  markKeySuccess,
  markKeyUsed,
  orderAgentKeys,
  type AgentKey,
} from '@/lib/ai-keys';
import {
  chatHeaders,
  chatRequestBody,
  defaultModelFor,
  isAiProviderId,
  modelIsAvailable,
  providerDefinition,
  providerErrorMessage,
  sanitizeModelId,
  type AiProviderId,
} from '@/lib/ai-providers';

export const runtime = 'nodejs';

const DEFAULT_PROVIDER: AiProviderId = 'groq';
const MAX_MESSAGES = 40;
const MAX_BODY_BYTES = 120_000;

// Free-tier requests are cheap but finite. Keep a small per-user window so a
// runaway tool loop cannot burn the whole daily quota in one conversation.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 5 * 60 * 1000;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(uid: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(uid);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(uid, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_portfolio_summary',
      description:
        "The user's current portfolio: total value, invested amount, profit/loss, allocation by category, and every holding with its weight. Use this before answering any question about the user's own money.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_exposure_summary',
      description:
        'Sector and market-cap exposure across the whole portfolio, including stocks held indirectly through mutual funds and ETFs. Use for questions like "how much IT exposure do I have?".',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_asset',
      description:
        'Search for a stock, ETF or mutual fund by name or ticker. Returns matching symbols and names. Use this when the user names an asset but you do not know its exact symbol.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Company or fund name, or a ticker symbol.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_quote',
      description:
        'Latest market price for one symbol (for example RELIANCE.NS, AAPL, BTC-USD).',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Exact Yahoo-style ticker symbol.' },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_fund_holdings',
      description:
        'Underlying stocks and sector weights for a mutual fund or ETF. Indian ETFs may return an index look-through rather than the exact portfolio; say so when the note indicates it.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Fund or ETF symbol, e.g. MF_140084 or NIFTYBEES.NS.' },
          name: { type: 'string', description: 'Fund name, to help resolve the right scheme.' },
        },
        required: ['symbol'],
      },
    },
  },
];

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    'You are the portfolio assistant inside the Asset Allocation Tracker mobile app.',
    `Today is ${today}. All portfolio values are in Indian rupees (INR).`,
    '',
    'Rules:',
    '- Use the provided tools for facts. Never invent prices, holdings, weights or returns.',
    "- Call get_portfolio_summary before answering questions about the user's own portfolio.",
    '- Call get_exposure_summary for sector or market-cap questions.',
    '- Call search_asset first when you are unsure of an exact ticker.',
    '- Fund and ETF holdings may come from an index look-through. Mention that caveat when the note says so.',
    '- Format money with Indian digit grouping (for example ₹12,34,567). Keep answers under 180 words unless the user asks for detail.',
    '- Write for a small mobile chat screen: plain text only. Do not use Markdown bold/italics, headings, tables or code blocks. Simple "-" bullets and short paragraphs are fine.',
    '- You are read-only. You cannot add, edit or delete assets. If asked, say write actions are not available yet and point the user to the Assets tab.',
    '- If a tool fails or returns no data, say so plainly. Never fill gaps with made-up numbers.',
    '- Ask a short clarifying question when the request is ambiguous.',
  ].join('\n');
}

type SanitizedMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  extra_content?: unknown;
  reasoning_details?: unknown;
};

function sanitizeExtra(value: unknown): unknown {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > 8_000) return undefined;
    return JSON.parse(serialized);
  } catch {
    return undefined;
  }
}

function sanitizeMessages(input: unknown): SanitizedMessage[] {
  if (!Array.isArray(input)) return [];

  const messages: SanitizedMessage[] = [];
  for (const raw of input.slice(-MAX_MESSAGES)) {
    const item = raw as any;
    const role = item?.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue;

    const message: SanitizedMessage = {
      role,
      content:
        typeof item.content === 'string'
          ? item.content.slice(0, 8000)
          : item.content == null
            ? role === 'assistant'
              ? null
              : ''
            : String(item.content).slice(0, 8000),
    };

    if (Array.isArray(item.tool_calls)) {
      message.tool_calls = item.tool_calls.slice(0, 4).map((call: any, index: number) => {
        const args = call?.function?.arguments;
        const sanitizedCall: Record<string, unknown> = {
          id: String(call?.id || `call_${index}`),
          type: 'function',
          function: {
            name: String(call?.function?.name || ''),
            arguments:
              typeof args === 'string' ? args.slice(0, 4000) : JSON.stringify(args ?? {}),
          },
        };
        const extraContent = sanitizeExtra(call?.extra_content);
        if (extraContent) sanitizedCall.extra_content = extraContent;
        const reasoningDetails = sanitizeExtra(call?.reasoning_details);
        if (reasoningDetails) sanitizedCall.reasoning_details = reasoningDetails;
        return sanitizedCall;
      });
    }

    if (typeof item.tool_call_id === 'string') {
      message.tool_call_id = item.tool_call_id.slice(0, 200);
    }
    if (typeof item.name === 'string') {
      message.name = item.name.slice(0, 100);
    }

    // Gemini returns thought signatures in `extra_content`; OpenRouter returns
    // reasoning details. They must round-trip for multi-turn tool calls.
    const extraContent = sanitizeExtra(item.extra_content);
    if (extraContent) message.extra_content = extraContent;
    const reasoningDetails = sanitizeExtra(item.reasoning_details);
    if (reasoningDetails) message.reasoning_details = reasoningDetails;

    messages.push(message);
  }

  return messages;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Conversation is too large.' }, { status: 413 });
  }

  const auth = await resolveRequestUid(request);
  if ('response' in auth) return auth.response;
  const uid = auth.uid;

  if (isRateLimited(uid)) {
    return NextResponse.json(
      { error: 'Too many assistant requests. Wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const messages = sanitizeMessages(body?.messages);
  if (messages.length === 0) {
    return NextResponse.json({ error: 'Send at least one message.' }, { status: 400 });
  }

  const provider: AiProviderId = isAiProviderId(body?.provider)
    ? body.provider
    : DEFAULT_PROVIDER;
  const definition = providerDefinition(provider);
  const model = sanitizeModelId(body?.model) || defaultModelFor(provider);

  let pool: AgentKey[] = [];
  try {
    pool = await getAgentKeyPool(uid, provider);
  } catch (error: any) {
    console.error('[AGENT] Could not load the key pool:', error?.message || error);
    return NextResponse.json(
      { error: 'Could not load the AI key pool. Try again in a moment.' },
      { status: 503 },
    );
  }

  if (pool.length === 0) {
    return NextResponse.json(
      {
        error: `No ${definition.name} key is configured. Add one in Settings → AI assistant, or set ${definition.envKeyNames[0]} on the server.`,
      },
      { status: 503 },
    );
  }

  const discoveryKey = orderAgentKeys(pool).find((key) => agentKeyCooldownRemaining(key) === 0);
  if (discoveryKey && !(await modelIsAvailable(provider, model, discoveryKey.key))) {
    return NextResponse.json(
      {
        error: `The selected model is not available on ${definition.name}. Pick another model from the chat header.`,
      },
      { status: 400 },
    );
  }

  const providerBody = JSON.stringify(
    chatRequestBody(
      provider,
      model,
      [{ role: 'system', content: systemPrompt() }, ...messages],
      TOOLS,
    ),
  );

  // Stay inside the mobile client's 60s timeout even with several keys.
  const deadline = Date.now() + 55_000;
  let attempts = 0;
  let sawRateLimit = false;
  let sawAuthFailure = false;
  let sawTimeout = false;
  let lastStatus = 0;
  let lastProviderMessage = '';

  for (const key of orderAgentKeys(pool)) {
    if (agentKeyCooldownRemaining(key) > 0) continue;

    const remaining = deadline - Date.now();
    if (remaining < 3_000) break;

    attempts += 1;
    markKeyUsed(uid, key);

    try {
      const response = await fetch(definition.chatUrl, {
        method: 'POST',
        headers: chatHeaders(provider, key.key),
        body: providerBody,
        signal: AbortSignal.timeout(Math.min(30_000, remaining)),
        cache: 'no-store',
      });

      const text = await response.text();
      let payload: any = null;
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }

      const providerMessage = response.ok ? '' : providerErrorMessage(payload, text);
      void recordKeyResponse(provider, key.key, response.status, providerMessage, response);

      if (!response.ok) {
        console.warn(
          `[AGENT] ${definition.name} key ${key.id} failed (${response.status}):`,
          providerMessage.slice(0, 200),
        );
        markKeyFailure(uid, key, response.status, providerMessage);
        lastStatus = response.status;
        lastProviderMessage = providerMessage.slice(0, 300);

        if (response.status === 429) sawRateLimit = true;
        if (response.status === 401 || response.status === 403) sawAuthFailure = true;

        const retryable =
          response.status === 429 ||
          response.status === 401 ||
          response.status === 403 ||
          response.status === 408 ||
          response.status >= 500;
        if (retryable) continue;

        const messageText = String(providerMessage).toLowerCase();
        if (messageText.includes('guardrail') || messageText.includes('data policy')) {
          return NextResponse.json(
            {
              error:
                'This free OpenRouter model requires data logging. Enable it in OpenRouter privacy settings, or pick another model from the chat header.',
            },
            { status: 400 },
          );
        }
        if (response.status === 402 || messageText.includes('requires more credits')) {
          return NextResponse.json(
            {
              error: `The selected ${definition.name} model needs credits. Pick a free model or another provider from the chat header.`,
            },
            { status: 400 },
          );
        }
        if (response.status === 400 || response.status === 404 || response.status === 422) {
          const modelProblem =
            messageText.includes('tool') ||
            messageText.includes('function') ||
            messageText.includes('not found') ||
            messageText.includes('does not exist') ||
            messageText.includes('not supported');
          return NextResponse.json(
            {
              error: modelProblem
                ? `The selected ${definition.name} model cannot handle this request. Pick a different model from the chat header.`
                : 'The assistant could not process that request. Try a shorter or simpler question.',
            },
            { status: 400 },
          );
        }
        return NextResponse.json(
          { error: 'The AI provider could not answer. Try again shortly.' },
          { status: 502 },
        );
      }

      markKeySuccess(uid, key);
      const message = payload?.choices?.[0]?.message;
      if (!message) {
        return NextResponse.json(
          { error: 'The AI provider returned an empty response.' },
          { status: 502 },
        );
      }

      return NextResponse.json({
        message,
        provider,
        model: payload?.model || model,
        usage: payload?.usage ?? null,
      });
    } catch (error: any) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      if (timedOut) sawTimeout = true;
      console.warn(
        `[AGENT] ${definition.name} key ${key.id} request failed:`,
        error?.message || error,
      );
      void recordKeyResponse(
        provider,
        key.key,
        timedOut ? 408 : 0,
        error?.message || 'network error',
      );
      markKeyFailure(uid, key, timedOut ? 408 : 0, error?.message || 'network error');
    }
  }

  if (attempts === 0) {
    return NextResponse.json(
      {
        error: `Every ${definition.name} key is cooling down right now. Wait a minute, or add another key in Settings → AI assistant.`,
      },
      { status: 429 },
    );
  }

  if (sawRateLimit) {
    return NextResponse.json(
      {
        error: `All ${definition.name} keys are rate-limited right now. Wait a minute, or add another key in Settings → AI assistant.`,
      },
      { status: 429 },
    );
  }

  if (sawAuthFailure && !sawTimeout) {
    // A 403 is not always a bad key: Gemini, for example, returns one when the
    // project has no billing or API access enabled. Surface that explanation
    // instead of telling the user to replace a perfectly valid key.
    const accessProblem = /billing|free tier|quota|permission|not available|not enabled/i.test(
      lastProviderMessage,
    );
    return NextResponse.json(
      {
        error: accessProblem
          ? `${definition.name} could not use this key: ${lastProviderMessage}`
          : `${definition.name} rejected every key it tried. Check the key in Settings → AI assistant, or add another one.`,
      },
      { status: 502 },
    );
  }

  if (sawTimeout) {
    return NextResponse.json(
      { error: 'The assistant took too long to answer. Try again.' },
      { status: 504 },
    );
  }

  console.error('[AGENT] All key attempts failed. Last provider status:', lastStatus);
  return NextResponse.json(
    {
      error:
        'No AI key could answer right now. Try again shortly, or add another key in Settings → AI assistant.',
    },
    { status: 502 },
  );
}
