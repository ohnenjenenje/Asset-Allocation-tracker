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
  modelSupportsVision,
  providerDefinition,
  providerErrorMessage,
  sanitizeModelId,
  type AiProviderId,
} from '@/lib/ai-providers';

export const runtime = 'nodejs';

const DEFAULT_PROVIDER: AiProviderId = 'groq';
const MAX_MESSAGES = 40;
// Screenshots are compressed on-device before upload, but leave room for two
// images plus the conversation history. Next.js buffers the JSON body once.
const MAX_BODY_BYTES = 8_000_000;

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
  {
    type: 'function',
    function: {
      name: 'propose_asset_updates',
      description:
        'Prepare changes to existing holdings and show a confirmation card in the app. Use this after reading a screenshot, or when the user asks to change quantity, average buy price or manual price. This tool never saves; the user must tap Apply on the card.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description:
              'One short sentence describing the screenshot or requested change, for example "Zerodha holdings screenshot from 21 Nov".',
          },
          updates: {
            type: 'array',
            description: 'One entry per existing holding. Include only fields that should change.',
            items: {
              type: 'object',
              properties: {
                symbol: {
                  type: 'string',
                  description:
                    'Exact portfolio ticker, or the ticker/name visible in the screenshot.',
                },
                name: {
                  type: 'string',
                  description: 'Holding name from the screenshot, used when the ticker is unclear.',
                },
                quantity: {
                  type: 'number',
                  description: 'New total quantity held, not a delta.',
                },
                entryPrice: {
                  type: 'number',
                  description: 'New average buy price per unit.',
                },
                manualPrice: {
                  type: 'number',
                  description:
                    'New manual current price per unit. Only when explicitly requested; this overrides live market quotes.',
                },
              },
              required: ['symbol'],
            },
          },
        },
        required: ['summary', 'updates'],
      },
    },
  },
];

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    'You are the portfolio assistant inside the Asset Allocation Tracker mobile app.',
    `Today is ${today}. All portfolio values are in Indian rupees (INR) unless a holding is explicitly in another currency.`,
    '',
    'Rules:',
    '- Use the provided tools for facts. Never invent prices, holdings, weights or returns.',
    "- Call get_portfolio_summary before answering questions about the user's own portfolio.",
    '- Call get_exposure_summary for sector or market-cap questions.',
    '- Call search_asset first when you are unsure of an exact ticker.',
    '- Fund and ETF holdings may come from an index look-through. Mention that caveat when the note says so.',
    '- Format money with Indian digit grouping (for example ₹12,34,567). Keep answers under 180 words unless the user asks for detail.',
    '- Write for a small mobile chat screen: plain text only. Do not use Markdown bold/italics, headings, tables or code blocks. Simple "-" bullets and short paragraphs are fine.',
    '',
    'Screenshots and edits:',
    '- You can read screenshots of holdings, orders and price screens. Extract only values that are clearly legible. Never guess a number or what a column means.',
    '- If you receive an error saying the selected model does not support image input, tell the user it is text-only and suggest a model marked Image in the chat header.',
    '- A screenshot may be a single holding detail screen. Treat the screen title as the holding name and Current Holdings or Quantity as the quantity. Ignore cash, savings, totals, returns and current values; a detail screen titled "Silver Vault" showing grams of silver matches SILVER-INR-GRAM / Physical Silver (Per Gram).',
    '- Match each screenshot row to an existing holding by ticker or name. If a row does not match, do not propose it; mention it in your reply.',
    '- To change an existing holding, call propose_asset_updates. It shows a confirmation card; nothing is saved until the user taps Apply. Never say a change is saved before that.',
    '- Prefer quantity and average buy price (entryPrice). Propose manualPrice only when the user explicitly asks to update the current price, or clearly asks for prices to be updated from the screenshot. Manual prices override live quotes, so warn about that.',
    '- If a screenshot shows invested amount and quantity, you may derive the average buy price as amount / quantity. If it shows only a current price, do not overwrite entryPrice with it.',
    '- Do not convert currencies. Use the values shown and state the currency you assumed.',
    '- After calling propose_asset_updates, tell the user in one short paragraph what will change and ask them to tap Apply. Do not repeat the whole table.',
    '- You cannot add new assets, delete assets or change classification. Say so and point the user to the Assets tab.',
    '',
    'General:',
    '- If a tool fails or returns no data, say so plainly. Never fill gaps with made-up numbers.',
    '- Ask a short clarifying question when the request is ambiguous.',
  ].join('\n');
}

type AgentMode = 'chat' | 'extract';

type ExtractionHolding = {
  assetId?: string;
  symbol?: string;
  name?: string;
  type?: string;
};

/**
 * The client sends a compact list of saved holdings so the model can map
 * generic screenshot titles (for example "Silver Vault") to the right asset.
 * Keep the list small: it is prompt context, not a second portfolio payload.
 */
function extractionHoldings(input: unknown): ExtractionHolding[] {
  if (!Array.isArray(input)) return [];

  const holdings: ExtractionHolding[] = [];
  for (const raw of input.slice(0, 80)) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as any;
    const assetId = typeof item.assetId === 'string' ? item.assetId.trim().slice(0, 80) : '';
    const symbol = typeof item.symbol === 'string' ? item.symbol.trim().slice(0, 40) : '';
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 120) : '';
    const type = typeof item.type === 'string' ? item.type.trim().slice(0, 40) : '';
    if (!assetId && !symbol && !name) continue;

    holdings.push({
      ...(assetId ? { assetId } : {}),
      ...(symbol ? { symbol } : {}),
      ...(name ? { name } : {}),
      ...(type ? { type } : {}),
    });
  }
  return holdings;
}

/**
 * Screenshot extraction runs without tools. Groq's Qwen reads images well but
 * mangles complex tool-call JSON, so the model is asked for plain JSON and the
 * app turns those rows into a proposal locally.
 */
function extractionPrompt(holdings: ExtractionHolding[] = []) {
  const knownHoldings =
    holdings.length > 0
      ? [
          '',
          'Known holdings (match screenshot rows to these):',
          ...holdings.map((holding) =>
            [
              holding.assetId ? `assetId=${holding.assetId}` : '',
              holding.symbol ? `symbol=${holding.symbol}` : '',
              holding.name ? `name=${holding.name}` : '',
              holding.type ? `type=${holding.type}` : '',
            ]
              .filter(Boolean)
              .join(' | '),
          ),
          '',
        ]
      : [];

  return [
    'You read portfolio screenshots for the Asset Allocation Tracker app.',
    'Return only a JSON object with this shape:',
    '{"summary":"one short sentence","updates":[{"assetId":"id from the known holdings list, if matched","symbol":"TICKER","name":"Company name","quantity":10,"entryPrice":2400.5}]}',
    '',
    'Rules:',
    '- The screenshot may be a holdings table or a single holding detail screen.',
    '- For a single holding detail screen, use the screen title as the holding name and the value labelled Current Holdings, Quantity, Units or similar as quantity.',
    '- Match each row to a known holding above. If one holding is clearly the same product, copy its assetId, symbol and name exactly. For example, a screen titled "Silver Vault" showing grams of silver matches SILVER-INR-GRAM / Physical Silver (Per Gram).',
    '- If no known holding matches, omit assetId and return the row name or symbol exactly as shown in the screenshot.',
    '- Only include rows that are visibly present in the image. Do not add tickers, totals, recent activity or any other row from memory.',
    '- Ignore cash, savings, wallet, total, current value, market value, returns, percentages and recent activity. Do not turn "Active Savings" into a holding.',
    '- quantity is the new total quantity held in the unit shown (for example 6.2885 gm), not a delta.',
    '- entryPrice is the average buy price per unit. Set it only when the screenshot explicitly labels average buy price, avg cost, average price, buy price or invested amount. Never use current value, "Silver Value", market value, LTP or a price per unit as entryPrice.',
    '- Do not set manualPrice unless the user explicitly asked to update the current price. Prefer omitting it.',
    '- Include every holding whose quantity is clearly readable.',
    '- Omit rows you cannot read. Never guess a number or what a column means.',
    ...knownHoldings,
    '- If no holding row is readable, return {"summary":"No readable holdings","updates":[]}.',
    '- Do not include prose, Markdown or code fences.',
  ].join('\n');
}

type ExtractionUpdate = {
  assetId?: string;
  symbol?: string;
  name?: string;
  quantity?: number;
  entryPrice?: number;
  manualPrice?: number;
};

function extractionNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[,\s₹$]/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Accepts the JSON object Qwen returns in `message.content`, even if it wraps
 * the object in a code fence. Only the editable position fields survive.
 */
function parseExtraction(
  content: unknown,
): { summary: string; updates: ExtractionUpdate[] } | null {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
      .map((part: any) => part.text)
      .join('\n');
  }

  text = text.trim();
  if (!text) return null;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  if (!Array.isArray(parsed?.updates)) return null;

  const rawUpdates = parsed.updates.slice(0, 50);
  const updates: ExtractionUpdate[] = [];

  for (const raw of rawUpdates) {
    if (!raw || typeof raw !== 'object') continue;

    const assetId =
      typeof raw.assetId === 'string' ? raw.assetId.trim().slice(0, 80) : '';
    const symbol = typeof raw.symbol === 'string' ? raw.symbol.trim().slice(0, 40) : '';
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 120) : '';
    if (!assetId && !symbol && !name) continue;

    const update: ExtractionUpdate = {};
    if (assetId) update.assetId = assetId;
    if (symbol) update.symbol = symbol;
    if (name) update.name = name;

    const quantity = extractionNumber(raw.quantity);
    if (quantity != null && quantity > 0 && quantity <= 1e12) {
      update.quantity = quantity;
    }

    const entryPrice = extractionNumber(raw.entryPrice);
    if (entryPrice != null && entryPrice >= 0 && entryPrice <= 1e12) {
      update.entryPrice = entryPrice;
    }

    const manualPrice = extractionNumber(raw.manualPrice);
    if (manualPrice != null && manualPrice > 0 && manualPrice <= 1e12) {
      update.manualPrice = manualPrice;
    }

    updates.push(update);
  }

  const summary =
    typeof parsed?.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 300)
      : 'Screenshot holdings';

  return { summary, updates };
}

type SanitizedTextPart = { type: 'text'; text: string };
type SanitizedImagePart = { type: 'image_url'; image_url: { url: string } };
type SanitizedContent = string | null | Array<SanitizedTextPart | SanitizedImagePart>;

type SanitizedMessage = {
  role: 'user' | 'assistant' | 'tool';
  content: SanitizedContent;
  tool_calls?: unknown[];
  tool_call_id?: string;
  name?: string;
  extra_content?: unknown;
  reasoning_details?: unknown;
};

const MAX_TEXT_CHARS = 8_000;
// ~2.4 MB decoded. A compressed 1280px screenshot is normally well under this.
const MAX_IMAGE_CHARS = 3_200_000;
const MAX_IMAGES_PER_MESSAGE = 2;
const MAX_IMAGES_PER_REQUEST = 3;
const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i;

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

function sanitizeImageUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length > MAX_IMAGE_CHARS) return null;
  return IMAGE_DATA_URL.test(value) ? value : null;
}

/**
 * Keeps user text and, for user messages only, compressed image data URLs.
 * Everything else is flattened to text so a malformed or hostile part cannot
 * smuggle arbitrary provider fields through the proxy.
 */
function sanitizeContent(
  role: SanitizedMessage['role'],
  content: unknown,
  imageBudget: { remaining: number },
): SanitizedContent {
  if (typeof content === 'string') return content.slice(0, MAX_TEXT_CHARS);
  if (!Array.isArray(content)) {
    if (content == null) return role === 'assistant' ? null : '';
    return String(content).slice(0, MAX_TEXT_CHARS);
  }

  const textParts: string[] = [];
  const parts: Array<SanitizedTextPart | SanitizedImagePart> = [];
  let images = 0;

  for (const rawPart of content.slice(0, 8)) {
    if (!rawPart || typeof rawPart !== 'object') continue;
    const part = rawPart as any;

    if (part.type === 'text' && typeof part.text === 'string') {
      const text = part.text.slice(0, MAX_TEXT_CHARS);
      if (text) {
        textParts.push(text);
        parts.push({ type: 'text', text });
      }
      continue;
    }

    if (
      role === 'user' &&
      part.type === 'image_url' &&
      images < MAX_IMAGES_PER_MESSAGE &&
      imageBudget.remaining > 0
    ) {
      const url = sanitizeImageUrl(part?.image_url?.url);
      if (!url) continue;
      images += 1;
      imageBudget.remaining -= 1;
      parts.push({ type: 'image_url', image_url: { url } });
    }
  }

  if (images === 0) return textParts.join('\n').slice(0, MAX_TEXT_CHARS);
  return parts;
}

function sanitizeMessages(input: unknown): SanitizedMessage[] {
  if (!Array.isArray(input)) return [];

  const imageBudget = { remaining: MAX_IMAGES_PER_REQUEST };
  const messages: SanitizedMessage[] = [];
  for (const raw of input.slice(-MAX_MESSAGES)) {
    const item = raw as any;
    const role = item?.role;
    if (role !== 'user' && role !== 'assistant' && role !== 'tool') continue;

    const message: SanitizedMessage = {
      role,
      content: sanitizeContent(role, item.content, imageBudget),
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

const IMAGE_UNSUPPORTED_ERROR =
  'ERROR: Cannot read the attached screenshot (this model does not support image input). Inform the user that this model is text-only and suggest a model marked Image.';

/**
 * OpenCode-style capability guard: instead of rejecting the request, replace
 * each image with an explanatory text part. The model then tells the user that
 * the selected model cannot read images, which is clearer than a provider 400.
 */
function replaceUnsupportedImages(messages: SanitizedMessage[]): SanitizedMessage[] {
  let replaced = false;

  const next = messages.map((message) => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message;

    let changed = false;
    const content = message.content.map((part) => {
      if (part.type !== 'image_url') return part;
      changed = true;
      replaced = true;
      return { type: 'text' as const, text: IMAGE_UNSUPPORTED_ERROR };
    });

    return changed ? { ...message, content } : message;
  });

  return replaced ? next : messages;
}

/** Finds the newest user message that carries an image. */
function extractionMessage(messages: SanitizedMessage[]): SanitizedMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    if (message.content.some((part) => part.type === 'image_url')) return message;
  }
  return null;
}

/**
 * OpenRouter attaches `X-RateLimit-*` headers only when OpenRouter itself is
 * limiting the key. A 429 without them comes from the upstream model provider,
 * so the key is still healthy and should not be parked.
 */
function isUpstreamRateLimit(
  provider: AiProviderId,
  response: Response,
  payload: any,
): boolean {
  if (provider !== 'openrouter' || response.status !== 429) return false;

  const headers = response.headers;
  if (
    headers.get('x-ratelimit-limit') ||
    headers.get('x-ratelimit-remaining') ||
    headers.get('x-ratelimit-reset')
  ) {
    return false;
  }

  const providerCode = payload?.error?.metadata?.provider_code;
  return (
    providerCode != null ||
    /provider returned error/i.test(providerErrorMessage(payload))
  );
}

function formatWait(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
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

  const mode: AgentMode = body?.mode === 'extract' ? 'extract' : 'chat';
  const extractionHoldingsList =
    mode === 'extract' ? extractionHoldings(body?.holdings) : [];
  let extractionSource: SanitizedMessage | null = null;
  if (mode === 'extract') {
    extractionSource = extractionMessage(messages);
    if (!extractionSource) {
      return NextResponse.json(
        { error: 'Attach a screenshot to extract holdings.' },
        { status: 400 },
      );
    }
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

  // Match OpenCode's request pipeline: if the selected model is text-only,
  // replace attached images with a text error the model can explain. The app
  // sends its own capability flag, which avoids a model-list round trip; the
  // live catalogue is still checked when the client thinks the model can see.
  const clientVision =
    typeof body?.supportsVision === 'boolean' ? body.supportsVision : null;
  const liveVision =
    clientVision === false
      ? null
      : discoveryKey
        ? await modelSupportsVision(provider, model, discoveryKey.key)
        : null;
  const visionSupport =
    clientVision === false ? false : (liveVision ?? clientVision);

  if (mode === 'extract' && visionSupport === false) {
    return NextResponse.json(
      {
        error:
          'The selected model cannot read images. Pick a model marked Image from the chat header.',
      },
      { status: 400 },
    );
  }

  const requestMessages =
    mode === 'extract' && extractionSource ? [extractionSource] : messages;
  const providerMessages =
    mode === 'chat' && visionSupport === false
      ? replaceUnsupportedImages(requestMessages)
      : requestMessages;

  const providerBody = JSON.stringify(
    chatRequestBody(
      provider,
      model,
      [
        {
          role: 'system',
          content:
            mode === 'extract'
              ? extractionPrompt(extractionHoldingsList)
              : systemPrompt(),
        },
        ...providerMessages,
      ],
      mode === 'extract' ? [] : TOOLS,
      { json: mode === 'extract' },
    ),
  );

  // Stay inside the mobile client's 60s timeout even with several keys.
  const deadline = Date.now() + 55_000;
  let attempts = 0;
  let sawRateLimit = false;
  let sawUpstreamRateLimit = false;
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
      const upstreamRateLimit = isUpstreamRateLimit(provider, response, payload);
      void recordKeyResponse(provider, key.key, response.status, providerMessage, response, {
        upstreamRateLimit,
      });

      if (!response.ok) {
        console.warn(
          `[AGENT] ${definition.name} key ${key.id} failed (${response.status}):`,
          providerMessage.slice(0, 200),
        );
        markKeyFailure(uid, key, response.status, providerMessage, { upstreamRateLimit });
        lastStatus = response.status;
        lastProviderMessage = providerMessage.slice(0, 300);

        if (response.status === 429) {
          if (upstreamRateLimit) sawUpstreamRateLimit = true;
          else sawRateLimit = true;
        }
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

      if (mode === 'extract') {
        const extraction =
          parseExtraction(message.content) ??
          parseExtraction(message.reasoning_content) ??
          parseExtraction(message.reasoning);
        if (!extraction) {
          console.warn(
            '[AGENT] Could not parse screenshot extraction:',
            String(message.content ?? '').slice(0, 300),
          );
          return NextResponse.json(
            {
              error:
                payload?.choices?.[0]?.finish_reason === 'length'
                  ? 'The screenshot had too much text to read at once. Try a smaller crop.'
                  : 'The model did not return usable holding rows. Try a clearer screenshot, or pick a different model.',
            },
            { status: 502 },
          );
        }

        return NextResponse.json({
          extraction,
          provider,
          model: payload?.model || model,
          usage: payload?.usage ?? null,
        });
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
    const soonest = Math.min(
      ...pool
        .map((key) => agentKeyCooldownRemaining(key))
        .filter((remaining) => remaining > 0),
    );
    const waitText = Number.isFinite(soonest)
      ? ` The next key is ready in about ${formatWait(soonest)}.`
      : '';
    return NextResponse.json(
      {
        error: `Every ${definition.name} key is cooling down right now.${waitText} Add another key in Settings → AI assistant to skip the wait.`,
      },
      { status: 429 },
    );
  }

  if (sawRateLimit) {
    return NextResponse.json(
      {
        error: `All ${definition.name} keys are rate-limited right now. Try again shortly, or add another key in Settings → AI assistant.`,
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

  if (sawUpstreamRateLimit) {
    // The key is fine; the free model's upstream provider is busy. Replacing
    // the key would not help, so point at the model picker instead.
    return NextResponse.json(
      {
        error: `${definition.name} accepted the key, but the model provider is busy right now. Try again in a few seconds, or pick a different model from the chat header.`,
      },
      { status: 429 },
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
