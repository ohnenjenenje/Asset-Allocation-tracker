import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { SearchField } from '@/src/components/ui/SearchField';
import { radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import {
  mapSearchResult,
  useAssetSearch,
  type AssetSearchResult,
  type AssetSearchSelection,
} from './search';

interface AssetSearchProps {
  onSelect: (selection: AssetSearchSelection) => void;
  disabled?: boolean;
}

/**
 * Debounced asset lookup used by the Add Asset form. Selecting a hit fills the
 * instrument fields; the user can still overwrite any value manually below.
 */
export function AssetSearch({ onSelect, disabled = false }: AssetSearchProps) {
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AssetSearchResult | null>(null);
  const search = useAssetSearch(query, !disabled && selected == null);

  const changeQuery = (text: string) => {
    setQuery(text);
    setSelected(null);
  };

  const select = (result: AssetSearchResult) => {
    setSelected(result);
    setQuery(result.shortname || result.longname || result.symbol);
    onSelect(mapSearchResult(result));
  };

  const showResults = selected == null && query.trim().length >= 2;
  const results = search.data ?? [];

  return (
    <View style={styles.wrapper}>
      <SearchField
        value={query}
        onChangeText={changeQuery}
        placeholder="Search e.g. Reliance, TCS, gold"
        accessibilityLabel="Search for an asset"
        editable={!disabled}
      />

      {selected ? (
        <View style={[styles.selected, { backgroundColor: colors.accentSoft }]}>
          <Feather name="check-circle" size={15} color={colors.accent} />
          <View style={styles.selectedText}>
            <Text style={[styles.selectedName, { color: colors.text }]} numberOfLines={1}>
              {selected.shortname || selected.longname || selected.symbol}
            </Text>
            <Text style={[styles.selectedMeta, { color: colors.muted }]} numberOfLines={1}>
              {selected.symbol}
              {selected.quoteType ? ` · ${selected.quoteType}` : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => changeQuery('')}
            accessibilityRole="button"
            accessibilityLabel="Change selected asset"
            hitSlop={8}
          >
            <Text style={[styles.change, { color: colors.accent }]}>Change</Text>
          </Pressable>
        </View>
      ) : null}

      {showResults && search.isFetching ? (
        <View style={styles.statusRow}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={[styles.status, { color: colors.muted }]}>Searching…</Text>
        </View>
      ) : null}

      {showResults && search.error && !search.isFetching ? (
        <Text style={[styles.status, { color: colors.negative }]}>
          Search is unavailable right now. You can still enter the asset manually below.
        </Text>
      ) : null}

      {showResults &&
      !search.isFetching &&
      !search.error &&
      search.data &&
      results.length === 0 ? (
        <Text style={[styles.status, { color: colors.muted }]}>
          No matches. Try a shorter name or the ticker.
        </Text>
      ) : null}

      {showResults && results.length > 0 ? (
        <View style={[styles.results, { borderColor: colors.border }]}>
          {results.map((result, index) => (
            <Pressable
              key={result.symbol}
              onPress={() => select(result)}
              accessibilityRole="button"
              accessibilityLabel={`${result.shortname || result.longname || result.symbol}, ${result.symbol}`}
              style={({ pressed }) => [
                styles.result,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.resultText}>
                <Text style={[styles.resultName, { color: colors.text }]} numberOfLines={1}>
                  {result.shortname || result.longname || result.symbol}
                </Text>
                <Text style={[styles.resultMeta, { color: colors.muted }]} numberOfLines={1}>
                  {result.quoteType || 'Asset'}
                  {result.source ? ` · ${result.source}` : ''}
                </Text>
              </View>
              <Text style={[styles.resultSymbol, { color: colors.muted }]} numberOfLines={1}>
                {result.symbol}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space.sm },
  selected: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  selectedText: { flex: 1, gap: 1 },
  selectedName: { fontSize: 12.5, fontWeight: '600' },
  selectedMeta: { fontSize: 10 },
  change: { fontSize: 11.5, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  status: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
  results: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, overflow: 'hidden' },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm + 1,
    paddingHorizontal: space.md,
  },
  pressed: { opacity: 0.7 },
  resultText: { flex: 1, gap: 1 },
  resultName: { fontSize: 12, fontWeight: '500' },
  resultMeta: { fontSize: 9.5 },
  resultSymbol: { fontSize: 10, fontWeight: '600', maxWidth: '38%' },
});
