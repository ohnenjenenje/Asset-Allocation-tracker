import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Holding } from '@/src/features/portfolio/aggregate';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { formatRelativeTime } from '@/src/lib/format/time';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface HoldingRowProps {
  holding: Holding;
  weight?: number;
  accentColor?: string;
  rank?: number;
  onPress?: () => void;
  showWeight?: boolean;
  /** Extra context such as the number of consolidated lots. */
  metaLabel?: string;
}

function initials(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9 ]/g, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function HoldingRow({
  holding,
  weight = 0,
  accentColor,
  rank,
  onPress,
  showWeight = true,
  metaLabel,
}: HoldingRowProps) {
  const { colors } = useTheme();
  const { asset, pnl, pnlPercent, hasLivePrice } = holding;
  const tone = !hasLivePrice
    ? colors.muted
    : pnl > 0
      ? colors.positive
      : pnl < 0
        ? colors.negative
        : colors.muted;
  const tint = accentColor ?? colors.accent;
  const pnlLabel = hasLivePrice
    ? `${pnl >= 0 ? 'up' : 'down'} ${formatPercent(Math.abs(pnlPercent))}`
    : 'cost basis';
  const ageLabel = holding.quoteAsOf ? formatRelativeTime(holding.quoteAsOf) : '';
  const freshnessLabel = holding.quoteStale
    ? `cached${ageLabel ? ` · ${ageLabel}` : ''}`
    : ageLabel && ageLabel !== 'just now'
      ? `as of ${ageLabel}`
      : '';

  const body = (
    <View style={styles.body}>
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: `${tint}18` }]}>
          <Text style={[styles.avatarText, { color: tint }]}>{initials(asset.name)}</Text>
        </View>

        <View style={styles.identity}>
          <View style={styles.nameRow}>
            {rank ? (
              <Text style={[styles.rank, numeric, { color: colors.muted }]}>{rank}.</Text>
            ) : null}
            <Text style={[type.bodyMedium, styles.name, { color: colors.text }]} numberOfLines={1}>
              {asset.name}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
              {asset.symbol}
            </Text>
            {metaLabel ? (
              <>
                <Text style={[styles.meta, { color: colors.muted }]}>·</Text>
                <Text
                  style={[styles.meta, styles.metaFlex, { color: colors.muted }]}
                  numberOfLines={1}
                >
                  {metaLabel}
                </Text>
              </>
            ) : null}
            {!hasLivePrice ? (
              <View style={styles.staleRow}>
                <Feather name="clock" size={9} color={colors.muted} />
                <Text style={[styles.meta, { color: colors.muted }]}>cost basis</Text>
              </View>
            ) : freshnessLabel ? (
              <View style={styles.staleRow}>
                <Feather
                  name="clock"
                  size={9}
                  color={holding.quoteStale ? colors.warning : colors.muted}
                />
                <Text
                  style={[
                    styles.meta,
                    { color: holding.quoteStale ? colors.warning : colors.muted },
                  ]}
                >
                  {freshnessLabel}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.numbers}>
          <Text style={[styles.value, numeric, { color: colors.text }]} numberOfLines={1}>
            {formatCompactINR(holding.currentValue)}
          </Text>
          <Text style={[styles.pnl, numeric, { color: tone }]} numberOfLines={1}>
            {hasLivePrice ? formatPercent(pnlPercent, { signed: true }) : '—'}
          </Text>
        </View>

        {onPress ? (
          <Feather name="chevron-right" size={15} color={colors.border} style={styles.chevron} />
        ) : null}
      </View>

      {showWeight ? (
        <View style={styles.weightRow}>
          <View style={[styles.weightTrack, { backgroundColor: colors.cardMuted }]}>
            <View
              style={[
                styles.weightFill,
                { width: `${Math.min(Math.max(weight, 0), 100)}%`, backgroundColor: tint },
              ]}
            />
          </View>
          <Text style={[styles.weightValue, numeric, { color: colors.muted }]}>
            {formatPercent(Math.min(Math.max(weight, 0), 100))}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (!onPress) return body;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${asset.name}, ${formatCompactINR(holding.currentValue)}, ${pnlLabel}${
        showWeight && weight > 0 ? `, ${formatPercent(weight)} of portfolio` : ''
      }`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingVertical: space.md, gap: space.sm, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  identity: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rank: { fontSize: 12 },
  name: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  staleRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  meta: { fontSize: 11 },
  metaFlex: { flexShrink: 1 },
  numbers: { alignItems: 'flex-end', gap: 2 },
  value: { fontSize: 14, fontWeight: '600' },
  pnl: { fontSize: 11, fontWeight: '600' },
  chevron: { marginLeft: -space.xs },
  weightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginLeft: 34 + space.md,
  },
  weightTrack: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  weightFill: { height: '100%', borderRadius: 2 },
  weightValue: { fontSize: 10, width: 42, textAlign: 'right' },
  pressed: { opacity: 0.65 },
});
