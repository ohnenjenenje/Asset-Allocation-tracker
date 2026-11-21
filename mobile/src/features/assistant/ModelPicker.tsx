import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge } from '@/src/components/ui/Badge';
import { Banner } from '@/src/components/ui/Banner';
import { Button } from '@/src/components/ui/Button';
import { IconButton } from '@/src/components/ui/IconButton';
import { radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';
import type { AssistantModel, AssistantProvider } from './models';
import type { AssistantSelection } from './selection';

interface ModelPickerProps {
  visible: boolean;
  providers: AssistantProvider[];
  selection: AssistantSelection | null;
  loading: boolean;
  error: string | null;
  onSelect: (selection: AssistantSelection) => void;
  onClose: () => void;
  onRetry: () => void;
  onManageKeys: () => void;
}

type PickerRow =
  | { key: string; kind: 'provider'; provider: AssistantProvider }
  | { key: string; kind: 'model'; provider: AssistantProvider; model: AssistantModel }
  | { key: string; kind: 'provider-error'; provider: AssistantProvider };

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) {
    const value = tokens / 1_000_000;
    return `${Number.isInteger(value) ? value : value.toFixed(1)}M context`;
  }
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K context`;
  return `${tokens} context`;
}

export function ModelPicker({
  visible,
  providers,
  selection,
  loading,
  error,
  onSelect,
  onClose,
  onRetry,
  onManageKeys,
}: ModelPickerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const rows = useMemo<PickerRow[]>(() => {
    const query = search.trim().toLowerCase();
    const result: PickerRow[] = [];

    for (const provider of providers) {
      const providerMatches = provider.name.toLowerCase().includes(query);
      const models = query
        ? provider.models.filter(
            (model) =>
              providerMatches ||
              model.name.toLowerCase().includes(query) ||
              model.id.toLowerCase().includes(query),
          )
        : provider.models;

      if (models.length === 0) {
        if (
          provider.error &&
          (!query || provider.name.toLowerCase().includes(query))
        ) {
          result.push({ key: `${provider.id}-header`, kind: 'provider', provider });
          result.push({ key: `${provider.id}-error`, kind: 'provider-error', provider });
        }
        continue;
      }

      result.push({ key: `${provider.id}-header`, kind: 'provider', provider });
      for (const model of models) {
        result.push({
          key: `${provider.id}:${model.id}`,
          kind: 'model',
          provider,
          model,
        });
      }
    }

    return result;
  }, [providers, search]);

  const hasProviders = providers.length > 0;
  const noSearchResults = hasProviders && rows.length === 0 && !loading && !error;

  const renderRow = ({ item }: { item: PickerRow }) => {
    if (item.kind === 'provider') {
      return (
        <View style={styles.sectionRow}>
          <Text style={[type.label, { color: colors.muted }]}>{item.provider.name}</Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            {item.provider.models.length > 0
              ? `${item.provider.models.length} model${item.provider.models.length === 1 ? '' : 's'}`
              : 'Unavailable'}
          </Text>
        </View>
      );
    }

    if (item.kind === 'provider-error') {
      return (
        <View style={[styles.providerError, { backgroundColor: colors.negativeSoft }]}>
          <Feather name="alert-circle" size={15} color={colors.negative} />
          <Text style={[styles.providerErrorText, { color: colors.negative }]}>
            {item.provider.error}
          </Text>
        </View>
      );
    }

    const { provider, model } = item;
    const selected =
      selection?.provider === provider.id && selection?.model === model.id;

    return (
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync().catch(() => {});
          onSelect({ provider: provider.id, model: model.id });
        }}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={`${provider.name} ${model.name}`}
        style={({ pressed }) => [
          styles.modelRow,
          {
            backgroundColor: selected ? colors.accentSoft : colors.card,
            borderColor: selected ? colors.accent : colors.border,
          },
          pressed && styles.pressed,
        ]}
      >
        <View style={styles.modelText}>
          <View style={styles.modelTitleRow}>
            <Text
              numberOfLines={1}
              style={[type.bodyMedium, { color: colors.text, flexShrink: 1 }]}
            >
              {model.name}
            </Text>
            {model.free ? <Badge label="Free" tone="positive" /> : null}
            {model.supportsVision ? <Badge label="Image" tone="accent" /> : null}
          </View>
          {model.name !== model.id ? (
            <Text numberOfLines={1} style={[type.caption, { color: colors.muted }]}>
              {model.id}
            </Text>
          ) : null}
          {model.contextWindow ? (
            <Text style={[styles.contextText, { color: colors.muted }]}>
              {formatContext(model.contextWindow)}
            </Text>
          ) : null}
        </View>
        {selected ? <Feather name="check" size={18} color={colors.accent} /> : null}
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setSearch('')}
      presentationStyle="overFullScreen"
    >
      <View style={[styles.overlay, { backgroundColor: colors.overlay }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close model picker"
        />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.bg,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, space.lg),
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={[type.title, { color: colors.text }]}>Choose model</Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                Providers with a configured API key
              </Text>
            </View>
            <IconButton
              icon="x"
              onPress={onClose}
              accessibilityLabel="Close model picker"
            />
          </View>

          <View
            style={[
              styles.search,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="search" size={15} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search models or providers"
              placeholderTextColor={colors.muted}
              selectionColor={colors.accent}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search models"
              style={[styles.searchInput, type.body, { color: colors.text }]}
            />
            {search.length > 0 ? (
              <Pressable
                onPress={() => setSearch('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Feather name="x-circle" size={15} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>

          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={colors.accent} />
              <Text style={[type.caption, { color: colors.muted }]}>
                Loading models from your providers…
              </Text>
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <Banner tone="error" icon="wifi-off" message={error} />
              <Button
                label="Try again"
                icon="refresh-cw"
                variant="secondary"
                onPress={onRetry}
                fullWidth
              />
            </View>
          ) : !hasProviders ? (
            <View style={styles.centerState}>
              <View style={[styles.emptyIcon, { backgroundColor: colors.cardMuted }]}>
                <Feather name="key" size={20} color={colors.muted} />
              </View>
              <Text style={[type.title, { color: colors.text }]}>No provider connected</Text>
              <Text style={[styles.emptyText, { color: colors.muted }]}>
                Add a Groq, OpenRouter or Gemini key. The model list appears here as soon
                as a key is available.
              </Text>
              <Button
                label="Manage API keys"
                icon="key"
                onPress={onManageKeys}
                fullWidth
              />
            </View>
          ) : noSearchResults ? (
            <View style={styles.centerState}>
              <Text style={[type.bodyMedium, { color: colors.text }]}>
                No models match “{search.trim()}”
              </Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                Try a provider name, model name or model ID.
              </Text>
            </View>
          ) : (
            <FlatList
              data={rows}
              keyExtractor={(row) => row.key}
              renderItem={renderRow}
              style={styles.list}
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              ListFooterComponent={
                <Text style={[styles.footer, { color: colors.muted }]}>
                  Models are read live from each provider. Only providers with a
                  configured key are shown. Models marked Image can read
                  screenshots.
                </Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '86%',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingTop: space.sm,
    paddingHorizontal: space.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    marginBottom: space.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.md,
    marginBottom: space.md,
  },
  headerText: { flex: 1, gap: 2 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 42,
    marginBottom: space.md,
  },
  searchInput: { flex: 1, paddingVertical: space.sm },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { paddingBottom: space.lg, gap: space.xs },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    marginBottom: space.xs,
    paddingHorizontal: space.xs,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
  },
  modelText: { flex: 1, gap: 2 },
  modelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  contextText: { fontSize: 10, marginTop: 1 },
  providerError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
  },
  providerErrorText: { flex: 1, fontSize: 12, lineHeight: 17 },
  centerState: {
    paddingVertical: space.xxl,
    gap: space.md,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 300,
  },
  footer: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: space.lg,
    paddingHorizontal: space.md,
  },
  pressed: { opacity: 0.75 },
});
