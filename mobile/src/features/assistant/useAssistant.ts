import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/src/features/auth/AuthProvider';
import { ApiError } from '@/src/lib/api/client';

import {
  extractScreenshot,
  sendAgentRequest,
  type AgentImagePart,
  type AgentMessage,
  type AgentTextPart,
} from './api';
import {
  TOOL_LABELS,
  buildAssetProposal,
  executeAssistantTool,
  mergeAssetProposals,
  type AssetUpdateProposal,
  type AssistantContext,
} from './tools';

/** Compressed screenshot prepared for the vision model. */
export type AssistantAttachment = {
  /** Local file URI used for the preview thumbnail. */
  uri: string;
  /** `data:image/jpeg;base64,…` payload sent to the provider. */
  dataUrl: string;
  width: number;
  height: number;
};

export type AssistantProposalState = 'pending' | 'applied' | 'dismissed';

export type AssistantChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Human-readable labels for the lookups used to produce this answer. */
  tools?: string[];
  error?: boolean;
  /** Local screenshot attached to a user message. */
  imageUri?: string;
  /** Width / height of the attached screenshot, for the preview bubble. */
  imageAspectRatio?: number;
  /** Confirmation card produced by `propose_asset_updates`. */
  proposal?: AssetUpdateProposal;
  proposalState?: AssistantProposalState;
  proposalError?: string | null;
};

const MAX_TOOL_ROUNDS = 5;

const SCREENSHOT_PROMPT =
  'Read this screenshot and update the holdings where the values are clearly visible.';

const CHAT_STORAGE_VERSION = 1;
const CHAT_STORAGE_PREFIX = 'asset-tracker/assistant-chat';
const MAX_STORED_MESSAGES = 100;
const MAX_STORED_API_MESSAGES = 80;

type StoredAssistantConversation = {
  version: typeof CHAT_STORAGE_VERSION;
  messages: AssistantChatMessage[];
  apiMessages: AgentMessage[];
  idCounter: number;
  updatedAt: number;
};

function chatStorageKey(uid: string): string {
  return `${CHAT_STORAGE_PREFIX}/v${CHAT_STORAGE_VERSION}/${uid}`;
}

function isStoredMessage(value: unknown): value is AssistantChatMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== 'string' ||
    (item.role !== 'user' && item.role !== 'assistant') ||
    typeof item.content !== 'string'
  ) {
    return false;
  }

  if (item.proposal !== undefined) {
    const proposal = item.proposal as Record<string, unknown> | null;
    if (!proposal || typeof proposal !== 'object' || !Array.isArray(proposal.updates)) {
      return false;
    }
  }
  return true;
}

function isStoredApiMessage(value: unknown): value is AgentMessage {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    (item.role === 'user' || item.role === 'assistant' || item.role === 'tool') &&
    'content' in item
  );
}

function maxStoredMessageId(messages: AssistantChatMessage[]): number {
  let max = 0;
  for (const message of messages) {
    const match = /^m(\d+)$/.exec(message.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

function trimApiMessages(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= MAX_STORED_API_MESSAGES) return messages;

  let start = messages.length - MAX_STORED_API_MESSAGES;
  while (start < messages.length && messages[start].role === 'tool') start += 1;
  return messages.slice(start);
}

/**
 * AsyncStorage should never receive base64 screenshots. The visible chat keeps
 * its local preview URI; the provider history keeps a short text marker.
 */
function sanitizeApiMessagesForStorage(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    return {
      ...message,
      content: message.content.map((part) =>
        part.type === 'image_url'
          ? { type: 'text' as const, text: '[screenshot omitted]' }
          : part,
      ),
    };
  });
}

async function loadStoredConversation(
  uid: string,
): Promise<StoredAssistantConversation | null> {
  try {
    const raw = await AsyncStorage.getItem(chatStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed?.version !== CHAT_STORAGE_VERSION) return null;
    if (!Array.isArray(parsed.messages) || !Array.isArray(parsed.apiMessages)) return null;

    const messages = parsed.messages.filter(isStoredMessage).slice(-MAX_STORED_MESSAGES);
    const apiMessages = parsed.apiMessages
      .filter(isStoredApiMessage)
      .slice(-MAX_STORED_API_MESSAGES);
    const storedCounter = Number.isFinite(parsed.idCounter) ? Number(parsed.idCounter) : 0;
    const idCounter = Math.max(storedCounter, maxStoredMessageId(messages));

    return {
      version: CHAT_STORAGE_VERSION,
      messages,
      apiMessages,
      idCounter,
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

function saveStoredConversation(
  uid: string,
  conversation: StoredAssistantConversation,
): void {
  AsyncStorage.setItem(chatStorageKey(uid), JSON.stringify(conversation)).catch(() => {
    // A lost chat is not worth interrupting the conversation.
  });
}

function friendlyError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session expired. Sign in again to use the assistant.';
    if (error.status === 429) {
      return (
        error.message ||
        'The assistant is out of quota right now. Add another key in Settings → AI assistant, or try again in a minute.'
      );
    }
    if (error.status === 0) return 'Could not reach the server. Check your connection and the API URL.';
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Try again.';
}

function userContent(
  text: string,
  attachment?: AssistantAttachment,
): AgentMessage['content'] {
  if (!attachment) return text;

  const parts: (AgentTextPart | AgentImagePart)[] = [];
  if (text) parts.push({ type: 'text', text });
  parts.push({ type: 'image_url', image_url: { url: attachment.dataUrl } });
  return parts;
}

function contentText(content: AgentMessage['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is AgentTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/**
 * Images are only needed for the turn that reads them. Replacing old payloads
 * with a short marker keeps later requests small and avoids re-uploading the
 * same screenshot on every follow-up.
 */
function collapseScreenshots(messages: AgentMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;

    const text = message.content
      .filter((part): part is AgentTextPart => part.type === 'text')
      .map((part) => part.text)
      .join('\n')
      .trim();
    message.content = text ? `${text}\n[earlier screenshot omitted]` : '[earlier screenshot omitted]';
  }
}

export function useAssistant(
  context: AssistantContext,
  options: {
    disabled?: boolean;
    provider?: string;
    model?: string;
    supportsVision?: boolean;
  } = {},
) {
  const { getToken, isDemo, uid } = useAuth();
  const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  // The screen is keyed by uid, so an existing uid always starts unhydrated.
  const [hydrated, setHydrated] = useState(() => !uid || isDemo);

  const apiMessages = useRef<AgentMessage[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const loadedUidRef = useRef<string | null>(null);

  const nextId = () => `m${(idRef.current += 1)}`;

  useEffect(() => () => controllerRef.current?.abort(), []);

  // The assistant is a modal route, so leaving the screen unmounts the hook.
  // Restore the visible chat and the provider history for the signed-in user.
  // The screen remounts with a uid key, so state never leaks between accounts.
  useEffect(() => {
    if (!uid || isDemo) return;

    let cancelled = false;

    void loadStoredConversation(uid).then((stored) => {
      if (cancelled) return;
      if (stored) {
        setMessages(stored.messages);
        apiMessages.current = stored.apiMessages;
        idRef.current = stored.idCounter;
      }
      loadedUidRef.current = uid;
      setHydrated(true);
    });

    return () => {
      cancelled = true;
    };
  }, [isDemo, uid]);

  useEffect(() => {
    if (!hydrated || !uid || isDemo || loadedUidRef.current !== uid) return;

    saveStoredConversation(uid, {
      version: CHAT_STORAGE_VERSION,
      messages: messages.slice(-MAX_STORED_MESSAGES),
      apiMessages: trimApiMessages(sanitizeApiMessagesForStorage(apiMessages.current)),
      idCounter: idRef.current,
      updatedAt: Date.now(),
    });
  }, [hydrated, isDemo, messages, uid]);

  const send = useCallback(
    async (text: string, attachment?: AssistantAttachment) => {
      const trimmed = text.trim();
      const prompt = trimmed || (attachment ? SCREENSHOT_PROMPT : '');
      const provider = options.provider;
      const model = options.model;
      if (!prompt || !provider || !model || isSending || isDemo || options.disabled) return;
      if (!hydrated) return;

      const controller = new AbortController();
      controllerRef.current = controller;
      setIsSending(true);
      setActivity(null);
      setMessages((previous) => [
        ...previous,
        {
          id: nextId(),
          role: 'user',
          content: trimmed || 'Screenshot',
          ...(attachment
            ? {
                imageUri: attachment.uri,
                imageAspectRatio:
                  attachment.height > 0 ? attachment.width / attachment.height : 0.65,
              }
            : {}),
        },
      ]);
      apiMessages.current.push({
        role: 'user',
        content: userContent(prompt, attachment),
      });

      const usedTools: string[] = [];
      const proposals: AssetUpdateProposal[] = [];

      try {
        const token = await getToken();

        // Groq's Qwen reads screenshots accurately but corrupts the complex
        // propose_asset_updates arguments. Extract the rows as plain JSON
        // without tools, then build the proposal locally.
        if (attachment && options.supportsVision && provider === 'groq' && /qwen/i.test(model)) {
          setActivity('Reading the screenshot');

          const { extraction } = await extractScreenshot(attachment.dataUrl, {
            token,
            signal: controller.signal,
            provider,
            model,
            text: trimmed,
            supportsVision: options.supportsVision,
            holdings: context.assets.map((asset) => ({
              assetId: asset.id,
              symbol: asset.symbol,
              name: asset.name,
              type: asset.type,
            })),
          });

          apiMessages.current.push({
            role: 'assistant',
            content: `I read the screenshot. Extracted rows: ${JSON.stringify(
              extraction.updates,
            )}`,
          });

          const screen = extraction.screen?.trim().toLowerCase() ?? '';
          const isHoldingScreen =
            !screen || screen === 'holdings' || screen === 'detail';

          // Enforce the screen-type rule locally as well as in the prompt. A
          // model that mislabels an orders/watchlist screen must not be able to
          // turn its rows into portfolio changes.
          if (!isHoldingScreen) {
            setMessages((previous) => [
              ...previous,
              {
                id: nextId(),
                role: 'assistant',
                content: `That looks like a ${screen} screen, not a holdings screen. Open your Holdings screen and try again.`,
              },
            ]);
            return;
          }

          if (extraction.updates.length === 0) {
            const summary = extraction.summary.trim();
            setMessages((previous) => [
              ...previous,
              {
                id: nextId(),
                role: 'assistant',
                content:
                  summary ||
                  'I could not find any readable holding rows in that screenshot. Try a clearer crop.',
              },
            ]);
            return;
          }

          const result = buildAssetProposal(extraction, context.assets);
          if ('error' in result) {
            setMessages((previous) => [
              ...previous,
              {
                id: nextId(),
                role: 'assistant',
                content: result.error,
                ...(result.noChange ? {} : { error: true }),
              },
            ]);
            return;
          }

          const summary = extraction.summary.trim();
          setMessages((previous) => [
            ...previous,
            {
              id: nextId(),
              role: 'assistant',
              content: summary
                ? `${summary}\n\nReview the changes below and tap Apply to save.`
                : 'I prepared these changes. Review them below and tap Apply to save.',
              proposal: result.proposal,
              proposalState: 'pending' as const,
            },
          ]);
          return;
        }

        for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
          const response = await sendAgentRequest(apiMessages.current, {
            token,
            signal: controller.signal,
            provider,
            model,
            supportsVision: options.supportsVision,
          });
          const message = response.message;
          const toolCalls = message.tool_calls ?? [];

          // Keep provider-specific fields (Gemini thought signatures,
          // OpenRouter reasoning details) so the next tool round is accepted.
          apiMessages.current.push({
            ...message,
            role: 'assistant',
            content: message.content ?? null,
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
          });

          if (toolCalls.length === 0) {
            const answer = contentText(message.content).trim();
            const proposal = mergeAssetProposals(proposals);
            setMessages((previous) => [
              ...previous,
              {
                id: nextId(),
                role: 'assistant',
                content:
                  answer ||
                  (proposal
                    ? 'I prepared these changes. Review them below and tap Apply to save.'
                    : 'I could not produce an answer. Try rephrasing the question.'),
                tools: usedTools,
                ...(proposal ? { proposal, proposalState: 'pending' as const } : {}),
              },
            ]);
            return;
          }

          for (const call of toolCalls) {
            const label = TOOL_LABELS[call.function.name] || 'Looking that up';
            setActivity(label);
            if (!usedTools.includes(label)) usedTools.push(label);

            const result = await executeAssistantTool(
              call.function.name,
              call.function.arguments,
              context,
              {
                token,
                onProposal: (proposal) => proposals.push(proposal),
              },
            );

            apiMessages.current.push({
              role: 'tool',
              tool_call_id: call.id,
              name: call.function.name,
              content: result,
            });
          }
        }

        const proposal = mergeAssetProposals(proposals);
        setMessages((previous) => [
          ...previous,
          {
            id: nextId(),
            role: 'assistant',
            content:
              'I made several lookups but could not finish the answer. Try asking a simpler question.',
            tools: usedTools,
            ...(proposal ? { proposal, proposalState: 'pending' as const } : {}),
          },
        ]);
      } catch (error) {
        if (controller.signal.aborted) return;
        const proposal = mergeAssetProposals(proposals);
        const reason = friendlyError(error);
        setMessages((previous) => [
          ...previous,
          {
            id: nextId(),
            role: 'assistant',
            content: proposal
              ? `I prepared these changes, but the summary failed: ${reason}`
              : reason,
            tools: usedTools,
            error: !proposal,
            ...(proposal ? { proposal, proposalState: 'pending' as const } : {}),
          },
        ]);
      } finally {
        collapseScreenshots(apiMessages.current);
        controllerRef.current = null;
        setActivity(null);
        setIsSending(false);
      }
    },
    [
      context,
      getToken,
      hydrated,
      isDemo,
      isSending,
      options.disabled,
      options.model,
      options.provider,
      options.supportsVision,
    ],
  );

  const updateProposal = useCallback(
    (
      messageId: string,
      update: { state?: AssistantProposalState; error?: string | null },
    ) => {
      setMessages((previous) =>
        previous.map((message) =>
          message.id === messageId
            ? {
                ...message,
                ...(update.state ? { proposalState: update.state } : {}),
                ...(update.error !== undefined ? { proposalError: update.error } : {}),
              }
            : message,
        ),
      );
    },
    [],
  );

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    apiMessages.current = [];
    setMessages([]);
    setIsSending(false);
    setActivity(null);
  }, []);

  return { messages, isSending, activity, isReady: hydrated, send, reset, updateProposal };
}
