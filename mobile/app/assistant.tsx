import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '@/src/components/ui/Banner';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { ModelPicker } from '@/src/features/assistant/ModelPicker';
import {
  loadAssistantSelection,
  resolveSelection,
  saveAssistantSelection,
  selectionLabel,
  type AssistantSelection,
} from '@/src/features/assistant/selection';
import { useAssistant, type AssistantChatMessage } from '@/src/features/assistant/useAssistant';
import { useAssistantModels } from '@/src/features/assistant/useAssistantModels';
import { useAuth } from '@/src/features/auth/AuthProvider';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import { radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const SUGGESTIONS = [
  'What is my portfolio worth?',
  'Which sectors am I exposed to?',
  'Do I own HDFC Bank?',
  'How are my funds allocated?',
];

export default function AssistantScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDemo } = useAuth();
  const { summary, analytics, prices, fundHoldings, isLoading, error } = usePortfolioData();

  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [savedSelection, setSavedSelection] = useState<AssistantSelection | null>(null);
  const [selectionReady, setSelectionReady] = useState(false);
  const listRef = useRef<FlatList<AssistantChatMessage>>(null);

  const modelsQuery = useAssistantModels();
  const providers = modelsQuery.data?.providers ?? [];
  const selection = useMemo(
    () => resolveSelection(savedSelection, modelsQuery.data),
    [savedSelection, modelsQuery.data],
  );
  const modelLabel = useMemo(
    () => selectionLabel(selection, modelsQuery.data),
    [selection, modelsQuery.data],
  );

  useEffect(() => {
    let cancelled = false;
    void loadAssistantSelection().then((saved) => {
      if (cancelled) return;
      setSavedSelection(saved);
      setSelectionReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the resolved default once the saved preference has loaded, so a
  // default model is remembered for the next visit.
  useEffect(() => {
    if (!selectionReady || !selection) return;
    if (
      savedSelection?.provider === selection.provider &&
      savedSelection?.model === selection.model
    ) {
      return;
    }
    saveAssistantSelection(selection);
  }, [savedSelection, selection, selectionReady]);

  const context = useMemo(
    () => ({ summary, analytics, prices, fundHoldings }),
    [summary, analytics, prices, fundHoldings],
  );

  const disabled = isDemo || isLoading || !selection;
  const { messages, isSending, activity, send, reset } = useAssistant(context, {
    disabled,
    provider: selection?.provider,
    model: selection?.model,
  });

  const canSend = input.trim().length > 0 && !isSending && !disabled;

  const chooseModel = (next: AssistantSelection) => {
    setSavedSelection(next);
    saveAssistantSelection(next);
    setIsPickerOpen(false);
  };

  const modelButtonLabel = modelLabel
    ? `${modelLabel.provider} · ${modelLabel.model}`
    : modelsQuery.isLoading
      ? 'Loading models…'
      : 'Choose a model';

  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(timer);
  }, [messages, isSending, activity]);

  // Keep the latest messages visible when the keyboard opens and shrinks the list.
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      listRef.current?.scrollToEnd({ animated: true });
    });
    return () => subscription.remove();
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !canSend) return;
    setInput('');
    void send(text);
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.header}>
          <ScreenHeader
            eyebrow="AI ASSISTANT"
            title="Ask your portfolio"
            subtitle="Read-only · live prices and fund look-through"
          />
          {!isDemo ? (
            <View style={styles.controls}>
              <Pressable
                onPress={() => setIsPickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Change AI model"
                style={({ pressed }) => [
                  styles.modelButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="cpu" size={15} color={colors.accent} />
                <View style={styles.modelButtonText}>
                  <Text style={[type.label, { color: colors.muted }]}>Model</Text>
                  <Text
                    numberOfLines={1}
                    style={[type.caption, { color: colors.text }]}
                  >
                    {modelButtonLabel}
                  </Text>
                </View>
                <Feather name="chevron-down" size={15} color={colors.muted} />
              </Pressable>
              <Pressable
                onPress={() => router.push('/ai-keys')}
                accessibilityRole="button"
                accessibilityLabel="API keys and usage"
                style={({ pressed }) => [
                  styles.keysButton,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  pressed && styles.pressed,
                ]}
              >
                <Feather name="key" size={15} color={colors.accent} />
                <Text style={[type.caption, { color: colors.text }]}>Keys</Text>
              </Pressable>
              {messages.length > 0 ? (
                <IconButton
                  icon="rotate-ccw"
                  onPress={reset}
                  accessibilityLabel="Start a new conversation"
                />
              ) : null}
            </View>
          ) : null}
        </View>

        {isDemo ? (
          <View style={styles.notice}>
            <Banner
              tone="warning"
              icon="lock"
              message="Sign in with a real account to use the assistant. Demo mode stays read-only."
            />
          </View>
        ) : null}

        {!isDemo && !modelsQuery.isLoading && !selection ? (
          <View style={styles.notice}>
            <Banner
              tone={modelsQuery.error ? 'error' : 'warning'}
              icon={modelsQuery.error ? 'wifi-off' : 'key'}
              message={
                modelsQuery.error
                  ? 'Could not load the available models. Check your connection and try again.'
                  : providers.length > 0
                    ? 'Your providers are configured, but their model lists could not be loaded. Retry or check the keys.'
                    : 'No AI provider is connected. Add a Groq, OpenRouter or Gemini key to start chatting.'
              }
              actionLabel={
                modelsQuery.error || providers.length > 0 ? 'Retry' : 'Add key'
              }
              onAction={() => {
                if (modelsQuery.error || providers.length > 0) {
                  void modelsQuery.refetch();
                } else {
                  router.push('/ai-keys');
                }
              }}
            />
          </View>
        ) : null}

        {error ? (
          <View style={styles.notice}>
            <Banner
              tone="error"
              icon="wifi-off"
              message={
                error instanceof Error
                  ? error.message
                  : 'Your portfolio could not be loaded, so answers may be incomplete.'
              }
            />
          </View>
        ) : null}

        {messages.length === 0 && !isSending ? (
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.emptyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.heroIcon, { backgroundColor: colors.accentSoft }]}>
              <Feather name="zap" size={22} color={colors.accent} />
            </View>
            <Text style={[type.title, { color: colors.text, textAlign: 'center' }]}>
              Your money, explained
            </Text>
            <Text style={[styles.heroText, { color: colors.muted }]}>
              Ask about your holdings, allocation, sectors or any stock. I read your portfolio and
              live market data before answering.
            </Text>

            <View style={styles.suggestions}>
              {SUGGESTIONS.map((prompt) => (
                <Pressable
                  key={prompt}
                  onPress={() => void send(prompt)}
                  disabled={disabled}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.chip,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    pressed && styles.pressed,
                    disabled && styles.disabled,
                  ]}
                >
                  <Text style={[type.caption, { color: colors.text }]}>{prompt}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={[styles.disclaimer, { color: colors.muted }]}>
              Read-only for now — it cannot add or change holdings.
            </Text>
          </ScrollView>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(message) => message.id}
            style={styles.flex}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => <MessageBubble message={item} />}
            ListFooterComponent={
              isSending ? <TypingBubble label={activity || 'Thinking'} /> : null
            }
          />
        )}

        <View
          style={[
            styles.composer,
            { borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, space.md) },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={
              isLoading
                ? 'Loading your portfolio…'
                : isDemo
                  ? 'Sign in to chat'
                  : !selection
                    ? modelsQuery.isLoading
                      ? 'Loading models…'
                      : 'Add an API key to chat'
                    : 'Ask about your portfolio…'
            }
            placeholderTextColor={colors.muted}
            multiline
            maxLength={2000}
            editable={!disabled}
            style={[
              styles.input,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
            ]}
            accessibilityLabel="Message the portfolio assistant"
          />
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            style={({ pressed }) => [
              styles.send,
              { backgroundColor: canSend ? colors.accent : colors.cardMuted },
              pressed && canSend && styles.pressed,
            ]}
          >
            {isSending ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : (
              <Feather
                name="arrow-up"
                size={18}
                color={canSend ? colors.accentText : colors.muted}
              />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <ModelPicker
        visible={isPickerOpen}
        providers={providers}
        selection={selection}
        loading={modelsQuery.isLoading}
        error={
          modelsQuery.data
            ? null
            : modelsQuery.error instanceof Error
              ? modelsQuery.error.message
              : modelsQuery.error
                ? 'Could not load the available models.'
                : null
        }
        onSelect={chooseModel}
        onClose={() => setIsPickerOpen(false)}
        onRetry={() => {
          void modelsQuery.refetch();
        }}
        onManageKeys={() => {
          setIsPickerOpen(false);
          router.push('/ai-keys');
        }}
      />
    </Screen>
  );
}

function MessageBubble({ message }: { message: AssistantChatMessage }) {
  const { colors } = useTheme();
  const isUser = message.role === 'user';
  const background = isUser
    ? colors.accent
    : message.error
      ? colors.negativeSoft
      : colors.card;
  const foreground = isUser
    ? colors.accentText
    : message.error
      ? colors.negative
      : colors.text;

  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: background, borderColor: isUser ? colors.accent : colors.border },
        ]}
      >
        {isUser ? (
          <Text selectable style={[styles.bubbleText, { color: foreground }]}>
            {message.content}
          </Text>
        ) : (
          <MessageText content={message.content} color={foreground} />
        )}
      </View>
      {message.tools && message.tools.length > 0 ? (
        <Text style={[styles.toolNote, { color: colors.muted }]}>
          {message.tools.join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Tiny Markdown renderer for model output: bold spans, headings and bullets.
 * A full Markdown engine would be overkill for chat answers and adds weight.
 */
function inlineParts(text: string, keyPrefix: string) {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      const bold = part.startsWith('**') && part.endsWith('**');
      const value = bold ? part.slice(2, -2) : part.replace(/\*([^*]+)\*/g, '$1');
      return (
        <Text
          key={`${keyPrefix}-${index}`}
          selectable
          style={{ fontWeight: bold ? '700' : '400' }}
        >
          {value}
        </Text>
      );
    });
}

function MessageText({ content, color }: { content: string; color: string }) {
  const lines = content.split('\n');

  return (
    <View style={styles.messageText}>
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) return <View key={`gap-${index}`} style={styles.lineGap} />;

        const heading = trimmed.match(/^#{1,4}\s+(.*)$/);
        if (heading) {
          return (
            <Text
              key={`heading-${index}`}
              selectable
              style={[styles.bubbleText, { color, fontWeight: '700' }]}
            >
              {heading[1]}
            </Text>
          );
        }

        const bullet = trimmed.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (bullet) {
          return (
            <View key={`bullet-${index}`} style={styles.bulletRow}>
              <Text style={[styles.bubbleText, { color }]}>•</Text>
              <Text selectable style={[styles.bubbleText, styles.bulletText, { color }]}>
                {inlineParts(bullet[1], `bullet-${index}`)}
              </Text>
            </View>
          );
        }

        return (
          <Text key={`line-${index}`} selectable style={[styles.bubbleText, { color }]}>
            {inlineParts(trimmed, `line-${index}`)}
          </Text>
        );
      })}
    </View>
  );
}

function TypingBubble({ label }: { label: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.messageRow, styles.assistantRow]}>
      <View
        style={[
          styles.bubble,
          styles.typingBubble,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <ActivityIndicator size="small" color={colors.accent} />
        <Text style={[type.caption, { color: colors.muted, flexShrink: 1 }]}>{label}…</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: space.lg },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: -space.sm,
    marginBottom: space.md,
  },
  modelButton: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  modelButtonText: { flex: 1, gap: 1 },
  keysButton: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  notice: { paddingHorizontal: space.lg, paddingBottom: space.sm },
  emptyContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    paddingBottom: space.xl,
    gap: space.md,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 320,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  chip: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  disclaimer: { fontSize: 11, textAlign: 'center', marginTop: space.sm },
  listContent: {
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.lg,
    gap: space.md,
  },
  messageRow: { gap: space.xs },
  userRow: { alignItems: 'flex-end' },
  assistantRow: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '88%',
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  messageText: { gap: 3 },
  lineGap: { height: 3 },
  bulletRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  bulletText: { flex: 1 },
  toolNote: { fontSize: 10, fontStyle: 'italic', paddingHorizontal: space.xs },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    fontSize: 14,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.5 },
});
