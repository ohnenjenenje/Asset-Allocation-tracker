import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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

import { Badge } from '@/src/components/ui/Badge';
import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
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
import {
  useAssistant,
  type AssistantAttachment,
  type AssistantChatMessage,
} from '@/src/features/assistant/useAssistant';
import { useAssistantModels } from '@/src/features/assistant/useAssistantModels';
import {
  applyAssetProposal,
  type AssetChange,
} from '@/src/features/assistant/tools';
import { useAuth } from '@/src/features/auth/AuthProvider';
import { usePortfolioData, useSaveAssets } from '@/src/features/portfolio/queries';
import { radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const SUGGESTIONS = [
  'What is my portfolio worth?',
  'Which sectors am I exposed to?',
  'Do I own HDFC Bank?',
  'How are my funds allocated?',
];

const CHANGE_LABELS: Record<AssetChange['field'], string> = {
  quantity: 'Quantity',
  entryPrice: 'Average buy price',
  manualPrice: 'Manual price',
};

const MAX_DATA_URL_CHARS = 2_400_000;

function formatNumber(value: number, maximumFractionDigits: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits });
}

function formatChange(change: AssetChange, currency: string): string {
  if (change.field === 'quantity') {
    const from = change.from == null ? '—' : formatNumber(change.from, 6);
    return `${from} → ${formatNumber(change.to, 6)}`;
  }

  const symbol = currency === 'USD' ? '$' : '₹';
  const from =
    change.from == null ? 'none' : `${symbol}${formatNumber(change.from, 4)}`;
  return `${from} → ${symbol}${formatNumber(change.to, 4)}`;
}

async function compressScreenshot(
  asset: ImagePicker.ImagePickerAsset,
): Promise<AssistantAttachment> {
  const attempts = [
    { width: 1280, compress: 0.7 },
    { width: 1000, compress: 0.55 },
    { width: 820, compress: 0.45 },
  ];

  let fallback: AssistantAttachment | null = null;

  for (const attempt of attempts) {
    const context = ImageManipulator.manipulate(asset.uri);
    if (asset.width && asset.width > attempt.width) {
      context.resize({ width: attempt.width });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      base64: true,
      compress: attempt.compress,
      format: SaveFormat.JPEG,
    });
    if (!saved.base64) continue;

    const dataUrl = `data:image/jpeg;base64,${saved.base64}`;
    const candidate: AssistantAttachment = {
      uri: saved.uri,
      dataUrl,
      width: saved.width,
      height: saved.height,
    };
    fallback = candidate;
    if (dataUrl.length <= MAX_DATA_URL_CHARS) return candidate;
  }

  if (fallback) return fallback;
  throw new Error('The image could not be prepared.');
}

export default function AssistantScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isDemo } = useAuth();
  const {
    summary,
    analytics,
    prices,
    fundHoldings,
    savedAssets,
    isLoading,
    error,
  } = usePortfolioData();
  const saveAssets = useSaveAssets();

  const [input, setInput] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [savedSelection, setSavedSelection] = useState<AssistantSelection | null>(null);
  const [selectionReady, setSelectionReady] = useState(false);
  const [attachment, setAttachment] = useState<AssistantAttachment | null>(null);
  const [isPreparingImage, setIsPreparingImage] = useState(false);
  const [applyingMessageId, setApplyingMessageId] = useState<string | null>(null);
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
  const selectedModel = useMemo(
    () =>
      providers
        .find((provider) => provider.id === selection?.provider)
        ?.models.find((model) => model.id === selection?.model) ?? null,
    [providers, selection],
  );
  const canReadImages = Boolean(selectedModel?.supportsVision);

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
    () => ({ summary, analytics, prices, fundHoldings, assets: savedAssets }),
    [summary, analytics, prices, fundHoldings, savedAssets],
  );

  const disabled = isDemo || isLoading || !selection;
  const { messages, isSending, activity, send, reset, updateProposal } = useAssistant(context, {
    disabled,
    provider: selection?.provider,
    model: selection?.model,
  });

  const canSend =
    (input.trim().length > 0 || attachment != null) &&
    (!attachment || canReadImages) &&
    !isSending &&
    !isPreparingImage &&
    !disabled;

  const chooseModel = (next: AssistantSelection) => {
    setSavedSelection(next);
    saveAssistantSelection(next);
    setIsPickerOpen(false);

    const nextModel = providers
      .find((provider) => provider.id === next.provider)
      ?.models.find((model) => model.id === next.model);
    if (attachment && nextModel && !nextModel.supportsVision) {
      setAttachment(null);
      Alert.alert(
        'Screenshot removed',
        'That model cannot read images. Pick a model marked Image to import a screenshot.',
      );
    }
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
    if (!canSend) return;
    const text = input.trim();
    const image = attachment ?? undefined;
    setInput('');
    setAttachment(null);
    void send(text, image);
  };

  const pickScreenshot = async (source: 'camera' | 'library') => {
    try {
      const permission =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          'Permission needed',
          source === 'camera'
            ? 'Allow camera access to photograph a holdings screen.'
            : 'Allow photo library access to choose a portfolio screenshot.',
        );
        return;
      }

      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              quality: 1,
              allowsEditing: false,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 1,
              allowsMultipleSelection: false,
              selectionLimit: 1,
            });

      if (result.canceled || result.assets.length === 0) return;

      setIsPreparingImage(true);
      const prepared = await compressScreenshot(result.assets[0]);
      setAttachment(prepared);
    } catch (pickError) {
      Alert.alert(
        'Could not add screenshot',
        pickError instanceof Error ? pickError.message : 'Try another image.',
      );
    } finally {
      setIsPreparingImage(false);
    }
  };

  const handleAttach = () => {
    if (disabled || isPreparingImage) return;

    if (modelsQuery.isLoading) {
      Alert.alert('Models are still loading', 'Try again in a moment.');
      return;
    }
    if (!selection) {
      Alert.alert('Add an API key', 'Connect a provider before importing screenshots.', [
        { text: 'Add key', onPress: () => router.push('/ai-keys') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    if (!canReadImages) {
      Alert.alert(
        'This model cannot read images',
        'Choose a model with the Image badge, such as Gemini or a vision OpenRouter model.',
        [
          { text: 'Choose model', onPress: () => setIsPickerOpen(true) },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
      return;
    }

    Alert.alert(
      'Add a screenshot',
      'The assistant reads the values and shows a confirmation card before anything is saved.',
      [
        { text: 'Photo library', onPress: () => void pickScreenshot('library') },
        { text: 'Camera', onPress: () => void pickScreenshot('camera') },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  };

  const handleApplyProposal = async (message: AssistantChatMessage) => {
    if (!message.proposal) return;

    setApplyingMessageId(message.id);
    try {
      const nextAssets = applyAssetProposal(savedAssets, message.proposal);
      await saveAssets.mutateAsync(nextAssets);
      updateProposal(message.id, { state: 'applied', error: null });
    } catch (saveError) {
      updateProposal(message.id, {
        error:
          saveError instanceof Error
            ? saveError.message
            : 'Could not save the changes. Try again.',
      });
    } finally {
      setApplyingMessageId(null);
    }
  };

  const handleDismissProposal = (message: AssistantChatMessage) => {
    updateProposal(message.id, { state: 'dismissed', error: null });
  };

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <View style={styles.header}>
          <ScreenHeader
            eyebrow="AI ASSISTANT"
            title="Ask your portfolio"
            subtitle="Screenshots · live prices and fund look-through"
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
              Ask about your holdings, allocation, sectors or any stock. You can also send a
              screenshot of a holdings or price screen and review the changes before saving.
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
              <Pressable
                onPress={handleAttach}
                disabled={disabled || isPreparingImage}
                accessibilityRole="button"
                accessibilityLabel="Import a screenshot"
                style={({ pressed }) => [
                  styles.chip,
                  styles.screenshotChip,
                  { backgroundColor: colors.accentSoft, borderColor: colors.accent },
                  pressed && styles.pressed,
                  (disabled || isPreparingImage) && styles.disabled,
                ]}
              >
                <Feather name="image" size={13} color={colors.accent} />
                <Text style={[type.caption, { color: colors.accent }]}>
                  Import a screenshot
                </Text>
              </Pressable>
            </View>

            <Text style={[styles.disclaimer, { color: colors.muted }]}>
              Screenshot changes are applied only after you confirm. Live quotes stay
              authoritative unless you choose a manual price.
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
            renderItem={({ item }) => (
              <MessageBubble
                message={item}
                applying={applyingMessageId === item.id}
                onApply={() => void handleApplyProposal(item)}
                onDismiss={() => handleDismissProposal(item)}
              />
            )}
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
          {attachment ? (
            <View
              style={[
                styles.attachmentCard,
                { backgroundColor: colors.cardMuted, borderColor: colors.border },
              ]}
            >
              <Image
                source={{ uri: attachment.uri }}
                style={styles.attachmentPreview}
                resizeMode="cover"
              />
              <View style={styles.attachmentText}>
                <Text style={[type.caption, { color: colors.text }]}>
                  Screenshot attached
                </Text>
                <Text
                  numberOfLines={1}
                  style={[type.caption, { color: colors.muted }]}
                >
                  {selectedModel?.name ?? 'A vision model'} reads it; you confirm before saving.
                </Text>
              </View>
              <IconButton
                icon="x"
                variant="plain"
                size={32}
                onPress={() => setAttachment(null)}
                accessibilityLabel="Remove screenshot"
              />
            </View>
          ) : null}

          <View style={styles.composerRow}>
            <Pressable
              onPress={handleAttach}
              disabled={disabled || isPreparingImage}
              accessibilityRole="button"
              accessibilityLabel="Add a screenshot"
              accessibilityHint="Choose a portfolio screenshot for the assistant to read"
              style={({ pressed }) => [
                styles.attachButton,
                { backgroundColor: colors.card, borderColor: colors.border },
                pressed && styles.pressed,
                (disabled || isPreparingImage) && styles.disabled,
              ]}
            >
              {isPreparingImage ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Feather
                  name="image"
                  size={18}
                  color={canReadImages ? colors.accent : colors.muted}
                />
              )}
            </Pressable>

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
                      : attachment
                        ? 'Add a note (optional)…'
                        : 'Ask or attach a screenshot…'
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

function MessageBubble({
  message,
  applying,
  onApply,
  onDismiss,
}: {
  message: AssistantChatMessage;
  applying: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
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
  const showContent = !(isUser && message.imageUri && message.content === 'Screenshot');

  return (
    <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
      <View
        style={[
          styles.bubble,
          { backgroundColor: background, borderColor: isUser ? colors.accent : colors.border },
        ]}
      >
        {message.imageUri ? (
          <Image
            source={{ uri: message.imageUri }}
            style={[
              styles.messageImage,
              {
                height: Math.min(
                  300,
                  210 / Math.min(Math.max(message.imageAspectRatio ?? 0.7, 0.3), 2.4),
                ),
                backgroundColor: colors.cardMuted,
              },
            ]}
            resizeMode="cover"
            accessibilityLabel="Screenshot sent to the assistant"
          />
        ) : null}
        {showContent ? (
          isUser ? (
            <Text selectable style={[styles.bubbleText, { color: foreground }]}>
              {message.content}
            </Text>
          ) : (
            <MessageText content={message.content} color={foreground} />
          )
        ) : null}
      </View>

      {message.proposal ? (
        <View style={styles.proposalWrap}>
          <ProposalCard
            proposal={message.proposal}
            state={message.proposalState ?? 'pending'}
            error={message.proposalError ?? null}
            applying={applying}
            onApply={onApply}
            onDismiss={onDismiss}
          />
        </View>
      ) : null}

      {message.tools && message.tools.length > 0 ? (
        <Text style={[styles.toolNote, { color: colors.muted }]}>
          {message.tools.join(' · ')}
        </Text>
      ) : null}
    </View>
  );
}

function ProposalCard({
  proposal,
  state,
  error,
  applying,
  onApply,
  onDismiss,
}: {
  proposal: NonNullable<AssistantChatMessage['proposal']>;
  state: NonNullable<AssistantChatMessage['proposalState']>;
  error: string | null;
  applying: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const applied = state === 'applied';
  const dismissed = state === 'dismissed';
  const hasManualPrice = proposal.updates.some((update) =>
    update.changes.some((change) => change.field === 'manualPrice'),
  );

  return (
    <Card
      style={[
        styles.proposalCard,
        applied && { borderColor: colors.positive },
      ]}
    >
      <View style={styles.proposalHeader}>
        <View
          style={[
            styles.proposalIcon,
            { backgroundColor: applied ? colors.positiveSoft : colors.accentSoft },
          ]}
        >
          <Feather
            name={applied ? 'check' : dismissed ? 'x' : 'edit-3'}
            size={15}
            color={applied ? colors.positive : dismissed ? colors.muted : colors.accent}
          />
        </View>
        <View style={styles.proposalHeaderText}>
          <Text style={[type.bodyMedium, { color: colors.text }]}>
            Review changes
          </Text>
          <Text numberOfLines={2} style={[type.caption, { color: colors.muted }]}>
            {proposal.summary}
          </Text>
        </View>
        <Badge
          label={applied ? 'Applied' : dismissed ? 'Dismissed' : 'Confirm'}
          tone={applied ? 'positive' : dismissed ? 'neutral' : 'warning'}
        />
      </View>

      <View style={styles.proposalAssets}>
        {proposal.updates.map((update) => (
          <View
            key={update.assetId}
            style={[styles.proposalAsset, { borderTopColor: colors.border }]}
          >
            <Text style={[type.bodyMedium, { color: colors.text }]}>
              {update.name}
            </Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              {update.symbol}
            </Text>
            {update.changes.map((change) => (
              <View key={change.field} style={styles.changeRow}>
                <Text style={[type.caption, { color: colors.muted }]}>
                  {CHANGE_LABELS[change.field]}
                </Text>
                <Text
                  style={[
                    type.caption,
                    styles.changeValue,
                    { color: colors.text },
                  ]}
                >
                  {formatChange(change, update.currency)}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>

      {state === 'pending' ? (
        <>
          {hasManualPrice ? (
            <Text style={[styles.proposalWarning, { color: colors.warning }]}>
              Manual prices override live market quotes for those holdings.
            </Text>
          ) : null}
          <Text style={[styles.proposalNote, { color: colors.muted }]}>
            Nothing is saved until you tap Apply. Holdings without a manual price keep
            using live quotes.
          </Text>
          {error ? (
            <Text style={[styles.proposalError, { color: colors.negative }]}>
              {error}
            </Text>
          ) : null}
          <View style={styles.proposalActions}>
            <Button
              label="Apply"
              icon="check"
              size="sm"
              loading={applying}
              onPress={onApply}
              style={styles.flex}
            />
            <Button
              label="Dismiss"
              variant="secondary"
              size="sm"
              disabled={applying}
              onPress={onDismiss}
              style={styles.flex}
            />
          </View>
        </>
      ) : applied ? (
        <Text style={[styles.proposalNote, { color: colors.positive }]}>
          Saved to your portfolio.
        </Text>
      ) : (
        <Text style={[styles.proposalNote, { color: colors.muted }]}>
          Dismissed. Nothing was changed.
        </Text>
      )}
    </Card>
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
  screenshotChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  disclaimer: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: space.sm },
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
  messageImage: {
    width: 210,
    borderRadius: radius.md,
    marginBottom: space.xs,
  },
  messageText: { gap: 3 },
  lineGap: { height: 3 },
  bulletRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  bulletText: { flex: 1 },
  proposalWrap: { width: '100%', marginTop: space.xs },
  proposalCard: { gap: space.sm },
  proposalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
  },
  proposalIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proposalHeaderText: { flex: 1, gap: 2 },
  proposalAssets: { gap: space.sm },
  proposalAsset: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
    gap: 3,
  },
  changeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  changeValue: { fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  proposalWarning: { fontSize: 11, lineHeight: 16 },
  proposalNote: { fontSize: 11, lineHeight: 16 },
  proposalError: { fontSize: 11, lineHeight: 16 },
  proposalActions: {
    flexDirection: 'row',
    gap: space.sm,
    marginTop: space.xs,
  },
  toolNote: { fontSize: 10, fontStyle: 'italic', paddingHorizontal: space.xs },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  composer: {
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
  },
  attachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.sm,
  },
  attachmentPreview: {
    width: 40,
    height: 50,
    borderRadius: radius.sm,
  },
  attachmentText: { flex: 1, gap: 2 },
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
