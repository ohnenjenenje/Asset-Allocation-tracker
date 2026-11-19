import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import { TextField } from '@/src/components/ui/TextField';
import type { AiKeyEntry, AiKeyUsage } from '@/src/features/assistant/keys';
import { EMPTY_KEY_USAGE } from '@/src/features/assistant/keys';
import { PROVIDER_LABELS } from '@/src/features/assistant/models';
import { useAiKeys } from '@/src/features/assistant/useAiKeys';
import { useAuth } from '@/src/features/auth/AuthProvider';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const DEFAULT_MAX_KEYS = 10;

function formatCount(value: number): string {
  return value.toLocaleString('en-IN');
}

function usageSummary(usage: AiKeyUsage): string {
  if (usage.requests === 0) return 'No requests recorded yet';
  const parts = [
    `${formatCount(usage.requests)} request${usage.requests === 1 ? '' : 's'} total`,
    `${formatCount(usage.todayRequests)} today`,
  ];
  if (usage.failures > 0) parts.push(`${formatCount(usage.failures)} failed`);
  return parts.join(' · ');
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Groq reports a duration ("1m26.4s"), OpenRouter reports epoch milliseconds
 * in X-RateLimit-Reset and Gemini usually reports nothing. Normalise the ones
 * we can and leave Groq's readable value alone.
 */
function formatReset(value: string | null, fallbackIso: string | null): string | null {
  let until: number | null = null;

  if (value) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (numeric > 1e12) until = numeric;
      else if (numeric > 1e9) until = numeric * 1000;
      else until = Date.now() + numeric * 1000;
    } else {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) until = parsed;
      else return value;
    }
  }

  if (until == null && fallbackIso) {
    const parsed = Date.parse(fallbackIso);
    if (Number.isFinite(parsed)) until = parsed;
  }

  return until == null ? null : formatDuration(Math.max(0, until - Date.now()));
}

function quotaLines(usage: AiKeyUsage): string[] {
  const lines: string[] = [];

  if (usage.limitRequests != null) {
    const left =
      usage.remainingRequests != null
        ? `${formatCount(usage.remainingRequests)}/${formatCount(usage.limitRequests)} requests left`
        : `${formatCount(usage.limitRequests)} requests per window`;
    const reset = formatReset(usage.resetRequests, usage.limitResetAt);
    lines.push(reset ? `${left} · resets ${reset}` : left);
  } else if (usage.remainingRequests != null) {
    const left = `${formatCount(usage.remainingRequests)} requests left`;
    const reset = formatReset(usage.resetRequests, usage.limitResetAt);
    lines.push(reset ? `${left} · resets ${reset}` : left);
  }

  if (usage.limitTokens != null && usage.remainingTokens != null) {
    const left = `${formatCount(usage.remainingTokens)}/${formatCount(usage.limitTokens)} tokens left`;
    const reset = formatReset(usage.resetTokens, usage.limitResetAt);
    lines.push(reset ? `${left} · resets ${reset}` : left);
  }

  return lines;
}

export default function AiKeysScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { isDemo } = useAuth();
  const { list, add, remove } = useAiKeys();

  const [keyInput, setKeyInput] = useState('');
  const [label, setLabel] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const keys = list.data?.keys ?? [];
  const maxKeys = list.data?.maxKeys ?? DEFAULT_MAX_KEYS;
  const loading = list.isLoading;
  const loadError = list.error
    ? list.error instanceof Error
      ? list.error.message
      : 'Could not load your AI keys.'
    : null;

  const personalCount = keys.filter((entry) => entry.source === 'account').length;
  const serverCount = keys.length - personalCount;
  const canAdd =
    !isDemo && !add.isPending && personalCount < maxKeys && keyInput.trim().length > 0;

  const handleAdd = async () => {
    const value = keyInput.trim();
    if (!value || add.isPending || isDemo) return;

    setFormError(null);
    setNotice(null);
    setActionError(null);
    try {
      const response = await add.mutateAsync({
        key: value,
        label: label.trim() || undefined,
      });
      setKeyInput('');
      setLabel('');
      setNotice(
        `${response.key.label} added. ${PROVIDER_LABELS[response.key.provider]} models now appear in the chat model picker.`,
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not add the key.',
      );
    }
  };

  const removeKey = async (entry: AiKeyEntry) => {
    setDeletingId(entry.id);
    setNotice(null);
    setActionError(null);
    try {
      await remove.mutateAsync(entry.id);
      setNotice(`${entry.label} removed.`);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Could not remove the key.',
      );
    } finally {
      setDeletingId(null);
    }
  };

  const confirmDelete = (entry: AiKeyEntry) => {
    Alert.alert(
      'Remove key?',
      `${entry.label} (${entry.masked}) will no longer be used by the assistant.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeKey(entry);
          },
        },
      ],
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
      >
        <ScreenHeader
          eyebrow="AI ASSISTANT"
          title="API keys"
          subtitle="Groq, OpenRouter and Gemini keys, rotated per provider"
          action={
            <IconButton
              icon="x"
              onPress={() => router.back()}
              accessibilityLabel="Close API key settings"
            />
          }
        />

        <View style={styles.stack}>
          {isDemo ? (
            <Banner
              tone="warning"
              icon="lock"
              message="Sign in with a real account to add or manage AI keys. Demo mode cannot store them."
            />
          ) : null}

          <Banner
            tone="info"
            icon="shield"
            message="Keys are stored on the server under your account. They are never included in the app bundle."
          />

          {notice ? (
            <Banner tone="info" icon="check-circle" message={notice} />
          ) : null}
          {actionError ? (
            <Banner tone="error" icon="alert-circle" message={actionError} />
          ) : null}

          <View>
            <SectionHeader
              title="Configured keys"
              subtitle={
                isDemo
                  ? 'Sign in to view keys'
                  : `${personalCount}/${maxKeys} personal${serverCount > 0 ? ` · ${serverCount} server` : ''}`
              }
            />

            {loading ? (
              <Card style={styles.loadingCard}>
                <Skeleton height={16} width="55%" />
                <Skeleton height={12} width="35%" />
                <Skeleton height={16} width="45%" />
                <Skeleton height={12} width="30%" />
              </Card>
            ) : loadError ? (
              <ErrorState
                title="Could not load keys"
                message={loadError}
                onRetry={() => void list.refetch()}
              />
            ) : keys.length === 0 ? (
              <Card style={styles.emptyCard}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.cardMuted }]}>
                  <Feather name="key" size={20} color={colors.muted} />
                </View>
                <Text style={[type.title, { color: colors.text }]}>No keys yet</Text>
                <Text style={[type.caption, styles.emptyText, { color: colors.muted }]}>
                  Add a Groq, OpenRouter or Gemini key below. It is checked with the
                  provider before it is saved.
                </Text>
              </Card>
            ) : (
              <Card padded={false}>
                {keys.map((entry, index) => {
                  const usage = entry.usage ?? EMPTY_KEY_USAGE;
                  const quota = quotaLines(usage);
                  return (
                    <View key={entry.id}>
                      {index > 0 ? (
                        <View
                          style={[styles.divider, { backgroundColor: colors.border }]}
                        />
                      ) : null}
                      <View style={styles.keyRow}>
                        <View
                          style={[
                            styles.keyIcon,
                            {
                              backgroundColor:
                                entry.source === 'environment'
                                  ? colors.accentSoft
                                  : colors.cardMuted,
                            },
                          ]}
                        >
                          <Feather
                            name={entry.source === 'environment' ? 'server' : 'key'}
                            size={15}
                            color={
                              entry.source === 'environment'
                                ? colors.accent
                                : colors.muted
                            }
                          />
                        </View>
                        <View style={styles.keyText}>
                          <Text
                            style={[type.bodyMedium, { color: colors.text }]}
                            numberOfLines={1}
                          >
                            {entry.label}
                          </Text>
                          <Text style={[type.caption, { color: colors.muted }]}>
                            {PROVIDER_LABELS[entry.provider]} · {entry.masked}
                          </Text>
                          <Text style={[styles.usageText, { color: colors.textSecondary }]}>
                            {usageSummary(usage)}
                          </Text>
                          {quota.map((line) => (
                            <Text
                              key={line}
                              style={[
                                styles.usageText,
                                { color: usage.limitReached ? colors.negative : colors.muted },
                              ]}
                            >
                              {line}
                            </Text>
                          ))}
                        </View>
                        <Badge
                          label={
                            usage.limitReached
                              ? 'Limit reached'
                              : entry.status === 'cooling'
                                ? 'Cooling'
                                : entry.source === 'environment'
                                  ? 'Server'
                                  : 'Active'
                          }
                          tone={
                            usage.limitReached
                              ? 'negative'
                              : entry.status === 'cooling'
                                ? 'warning'
                                : entry.source === 'environment'
                                  ? 'accent'
                                  : 'positive'
                          }
                        />
                        {entry.source === 'account' ? (
                          deletingId === entry.id ? (
                            <ActivityIndicator size="small" color={colors.muted} />
                          ) : (
                            <Pressable
                              onPress={() => confirmDelete(entry)}
                              accessibilityRole="button"
                              accessibilityLabel={`Remove ${entry.label}`}
                              hitSlop={10}
                              style={({ pressed }) => [pressed && styles.pressed]}
                            >
                              <Feather name="trash-2" size={16} color={colors.muted} />
                            </Pressable>
                          )
                        ) : null}
                      </View>
                    </View>
                  );
                })}
              </Card>
            )}
          </View>

          <View>
            <SectionHeader
              title="Add a key"
              subtitle="Groq, OpenRouter or Gemini — detected automatically"
            />
            <Card style={styles.form}>
              <TextField
                label="API key"
                value={keyInput}
                onChangeText={setKeyInput}
                placeholder="gsk_…, sk-or-v1-… or AIza…"
                icon="key"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!isDemo && !add.isPending && personalCount < maxKeys}
              />
              <TextField
                label="Label (optional)"
                value={label}
                onChangeText={setLabel}
                placeholder="Personal key"
                maxLength={40}
                editable={!isDemo && !add.isPending && personalCount < maxKeys}
              />

              {formError ? (
                <Text style={[styles.formError, { color: colors.negative }]}>
                  {formError}
                </Text>
              ) : null}

              {personalCount >= maxKeys ? (
                <Text style={[styles.formError, { color: colors.warning }]}>
                  You have reached the {maxKeys}-key limit. Remove one before adding
                  another.
                </Text>
              ) : null}

              <Button
                label="Validate and add key"
                onPress={() => void handleAdd()}
                icon="plus"
                fullWidth
                loading={add.isPending}
                disabled={!canAdd}
              />
            </Card>
          </View>

          <Text style={[styles.footer, { color: colors.muted }]}>
            Counters update after each chat request. Quota figures come from the
            provider’s rate-limit headers, so they appear once a key has answered a
            request. Today uses UTC. If a key hits its limit, it cools down and the
            next key for that provider is tried automatically.
          </Text>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.xl },
  loadingCard: { gap: space.md },
  emptyCard: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  emptyText: { textAlign: 'center', maxWidth: 280, lineHeight: 18 },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  keyIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { flex: 1, gap: 2 },
  usageText: { fontSize: 11, lineHeight: 15, ...numeric },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: space.lg },
  form: { gap: space.lg },
  formError: { fontSize: 12, lineHeight: 17, marginHorizontal: 2 },
  pressed: { opacity: 0.6 },
  footer: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    paddingHorizontal: space.md,
  },
});
