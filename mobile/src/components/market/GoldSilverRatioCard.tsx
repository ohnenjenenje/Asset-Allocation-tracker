import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import { goldSilverEntryVerdict } from '@/src/features/market/entrySignal';
import { useGoldSilverRatio } from '@/src/features/market/goldSilver';
import {
  crossCheckView,
  formatUsd,
  goldSilverCheckSourceLabel,
  goldSilverSourceLabel,
} from '@/src/features/market/goldSilverFormat';
import { classifyGoldSilverRatio } from '@/src/features/market/ratioSignal';
import { formatPercent } from '@/src/lib/format/money';
import { formatRelativeTime } from '@/src/lib/format/time';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { GoldSilverScale } from './GoldSilverScale';
import { MarketSignalBadge } from './MarketSignalBadge';

/**
 * Market indicator rather than a portfolio holding. Yahoo's chart feed supplies
 * the COMEX futures used for physical gold/silver valuations; xaus.com provides
 * an independent spot ratio. Either feed can be primary, and the row names the
 * missing source so an unavailable cross-check is never mistaken for bad data.
 */
export function GoldSilverRatioCard() {
  const { colors } = useTheme();
  const { data, error, isLoading, isFetching, refetch } = useGoldSilverRatio();

  if (isLoading && !data) {
    return (
      <Card style={styles.card}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.warningSoft }]}>
            <Feather name="trending-up" size={16} color={colors.warning} />
          </View>
          <View style={styles.headerText}>
            <Text style={[type.title, { color: colors.text }]}>Gold / silver ratio</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              Loading market quotes…
            </Text>
          </View>
        </View>
        <Skeleton height={34} width="45%" />
        <Skeleton height={52} borderRadius={radius.md} />
        <Skeleton height={16} width="75%" />
      </Card>
    );
  }

  if (!data || data.ratio == null) {
    return (
      <Card>
        <ErrorState
          title="Ratio unavailable"
          message={
            error instanceof Error
              ? error.message
              : 'Gold and silver quotes could not be loaded. Check the connection and try again.'
          }
          onRetry={() => void refetch()}
        />
      </Card>
    );
  }

  const ratio = data.ratio;
  const check = crossCheckView(data.crossCheck.status);
  // Whichever feed is primary, the row names the *other* source as the check.
  const crossCheckSource = goldSilverCheckSourceLabel(data.primarySource);
  const independentRatio =
    data.primarySource === 'xaus' ? null : data.xaus?.ratio ?? null;
  const difference =
    data.crossCheck.differencePct != null
      ? `${formatPercent(data.crossCheck.differencePct)} apart`
      : 'difference unavailable';
  const crossCheckDetail =
    data.crossCheck.status === 'unavailable'
      ? data.primarySource === 'xaus'
        ? 'Yahoo futures quote unavailable · using xaus spot'
        : 'No independent xaus quote received'
      : independentRatio != null
        ? `${independentRatio.toFixed(2)} · ${difference}`
        : 'Independent quote unavailable';
  const updatedAt = data.asOf ? Date.parse(data.asOf) : null;
  const updatedLabel = data.stale
    ? 'last known quote'
    : formatRelativeTime(updatedAt) || 'time unavailable';
  const sourceLabel = goldSilverSourceLabel(data.primarySource);
  const checkTone =
    data.crossCheck.status === 'match'
      ? colors.positive
      : data.crossCheck.status === 'unavailable'
        ? colors.muted
        : colors.warning;
  const checkIcon =
    data.crossCheck.status === 'match'
      ? 'check'
      : data.crossCheck.status === 'unavailable'
        ? 'help-circle'
        : 'alert-circle';
  const signal = classifyGoldSilverRatio(ratio);
  const entry = goldSilverEntryVerdict(signal.zone);
  const signalTone =
    signal.zone === 'silver'
      ? colors.accent
      : signal.zone === 'gold'
        ? colors.warning
        : colors.muted;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.warningSoft }]}>
          <Feather name="trending-up" size={16} color={colors.warning} />
        </View>
        <View style={styles.headerText}>
          <Text style={[type.title, { color: colors.text }]}>Gold / silver ratio</Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            Ounces of silver per ounce of gold
          </Text>
        </View>
        <MarketSignalBadge
          label={entry.label}
          tone={entry.tone}
          icon={entry.icon}
        />
      </View>

      <View style={styles.ratioBlock}>
        <Text style={[styles.ratioValue, numeric, { color: colors.text }]}>
          {ratio.toFixed(2)}
        </Text>
        <View style={styles.ratioCopy}>
          <Text style={[type.bodyMedium, { color: colors.textSecondary }]}>
            1 oz gold ≈ {ratio.toFixed(1)} oz silver
          </Text>
          <Text style={[styles.updated, { color: colors.muted }]}>
            {sourceLabel} · {updatedLabel}
          </Text>
        </View>
      </View>

      <View style={[styles.signal, { backgroundColor: colors.cardMuted, borderLeftColor: signalTone }]}>
        <Text style={[styles.signalHeadline, { color: colors.text }]}>{signal.headline}</Text>
        <View style={styles.signalDetailRow}>
          <View style={[styles.signalDot, { backgroundColor: signalTone }]} />
          <Text style={[styles.signalDetail, { color: colors.textSecondary }]}>
            {signal.detail}
          </Text>
        </View>
        <GoldSilverScale ratio={ratio} />
      </View>

      <View style={[styles.prices, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.priceCell}>
          <Text style={[styles.priceLabel, { color: colors.muted }]}>Gold</Text>
          <Text style={[styles.priceValue, numeric, { color: colors.text }]}>
            {formatUsd(data.goldUsd)}
          </Text>
          <Text style={[styles.priceUnit, { color: colors.muted }]}>per troy ounce</Text>
        </View>
        <View style={[styles.priceDivider, { backgroundColor: colors.border }]} />
        <View style={styles.priceCell}>
          <Text style={[styles.priceLabel, { color: colors.muted }]}>Silver</Text>
          <Text style={[styles.priceValue, numeric, { color: colors.text }]}>
            {formatUsd(data.silverUsd)}
          </Text>
          <Text style={[styles.priceUnit, { color: colors.muted }]}>per troy ounce</Text>
        </View>
      </View>

      <View style={[styles.crossCheck, { borderTopColor: colors.border }]}>
        <View style={[styles.checkIcon, { backgroundColor: colors.cardMuted }]}>
          <Feather
            name={checkIcon}
            size={13}
            color={checkTone}
          />
        </View>
        <View style={styles.crossCheckText}>
          <Text style={[styles.crossCheckTitle, { color: colors.text }]}>
            {crossCheckSource} cross-check
          </Text>
          <Text style={[styles.crossCheckDetail, { color: colors.muted }]}>
            {crossCheckDetail}
          </Text>
        </View>
        <Badge label={check.label} tone={check.tone} />
        <IconButton
          icon="refresh-cw"
          variant="plain"
          size={32}
          onPress={() => void refetch()}
          accessibilityLabel="Refresh gold and silver ratio"
          disabled={isFetching}
        />
      </View>

      <Text style={[styles.note, { color: colors.muted }]}>
        High ratio = silver cheap vs gold; low ratio = gold cheap vs silver. The 50/80 bands
        are a relative-value heuristic, not investment advice — extremes can persist. Yahoo
        COMEX futures and xaus.com spot are cross-checked; if one feed is down, the other is
        used and the gap is marked unavailable.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  ratioBlock: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  ratioValue: { fontSize: 40, lineHeight: 44, fontWeight: '600', letterSpacing: -1.2 },
  ratioCopy: { flex: 1, gap: 3, paddingBottom: 4 },
  updated: { fontSize: 10.5 },
  signal: {
    borderLeftWidth: 3,
    borderRadius: radius.md,
    padding: space.md,
    gap: 6,
  },
  signalHeadline: { fontSize: 14, fontWeight: '600' },
  signalDetailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  signalDot: { width: 6, height: 6, borderRadius: 3, marginTop: 5 },
  signalDetail: { flex: 1, fontSize: 11, lineHeight: 16 },
  prices: {
    flexDirection: 'row',
    borderRadius: radius.md,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  priceCell: { flex: 1, gap: 2 },
  priceDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: space.md },
  priceLabel: { ...type.label, fontSize: 9.5, letterSpacing: 0.4 },
  priceValue: { fontSize: 15, fontWeight: '600' },
  priceUnit: { fontSize: 10 },
  crossCheck: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
  },
  checkIcon: {
    width: 26,
    height: 26,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crossCheckText: { flex: 1, gap: 1 },
  crossCheckTitle: { fontSize: 12, fontWeight: '600' },
  crossCheckDetail: { fontSize: 10.5 },
  note: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
});
