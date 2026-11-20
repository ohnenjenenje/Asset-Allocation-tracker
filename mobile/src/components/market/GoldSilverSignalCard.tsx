import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Card } from '@/src/components/ui/Card';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { ErrorState } from '@/src/components/ui/States';
import { goldSilverEntryVerdict } from '@/src/features/market/entrySignal';
import {
  crossCheckView,
  formatUsd,
  goldSilverCheckSourceLabel,
  goldSilverSourceLabel,
} from '@/src/features/market/goldSilverFormat';
import { useGoldSilverRatio } from '@/src/features/market/goldSilver';
import { classifyGoldSilverRatio } from '@/src/features/market/ratioSignal';
import { formatPercent } from '@/src/lib/format/money';
import { formatRelativeTime } from '@/src/lib/format/time';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { GoldSilverScale } from './GoldSilverScale';
import { MarketSignalBadge } from './MarketSignalBadge';
import { SignalCard } from './SignalCard';

/** Compact gold/silver entry signal; the detail screen carries the full feed table. */
export function GoldSilverSignalCard() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data, error, isLoading, refetch } = useGoldSilverRatio();
  const open = () => router.push('/research/gold-silver');

  if (isLoading && !data) {
    return (
      <SignalCard
        icon="trending-up"
        tint={colors.warning}
        tintSoft={colors.warningSoft}
        title="Gold / silver ratio"
        subtitle="Loading market quotes…"
        onPress={open}
        accessibilityLabel="Open the gold and silver signal"
      >
        <Skeleton height={34} width="45%" />
        <Skeleton height={48} borderRadius={radius.md} />
        <Skeleton height={16} width="70%" />
      </SignalCard>
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
  const signal = classifyGoldSilverRatio(ratio);
  const entry = goldSilverEntryVerdict(signal.zone);
  const check = crossCheckView(data.crossCheck.status);
  const checkSource = goldSilverCheckSourceLabel(data.primarySource);
  const independentRatio = data.primarySource === 'xaus' ? null : data.xaus?.ratio ?? null;
  const difference =
    data.crossCheck.differencePct != null
      ? `${formatPercent(data.crossCheck.differencePct)} apart`
      : 'difference unavailable';
  const crossCheckDetail =
    data.crossCheck.status === 'unavailable'
      ? data.primarySource === 'xaus'
        ? 'Yahoo futures unavailable · using xaus spot'
        : 'No independent xaus quote received'
      : independentRatio != null
        ? `${independentRatio.toFixed(2)} · ${difference}`
        : 'Independent quote unavailable';
  const updatedAt = data.asOf ? Date.parse(data.asOf) : null;
  const updatedLabel = data.stale
    ? 'last known quote'
    : formatRelativeTime(updatedAt) || 'time unavailable';
  const checkTone =
    data.crossCheck.status === 'match'
      ? colors.positive
      : data.crossCheck.status === 'unavailable'
        ? colors.muted
        : colors.warning;

  return (
    <SignalCard
      icon="trending-up"
      tint={colors.warning}
      tintSoft={colors.warningSoft}
      title="Gold / silver ratio"
      subtitle="Ounces of silver per ounce of gold"
      badge={<MarketSignalBadge label={entry.label} tone={entry.tone} icon={entry.icon} />}
      onPress={open}
      accessibilityLabel="Open the gold and silver signal"
      footer={
        <>
          <Text style={[styles.footerText, { color: colors.muted }]}>
            {goldSilverSourceLabel(data.primarySource)} · {updatedLabel}
          </Text>
          <Text style={[styles.footerSub, { color: colors.muted }]}>
            {data.stale ? 'Cached quote' : 'Tap for both feeds and the full cross-check'}
          </Text>
        </>
      }
    >
      <View style={styles.hero}>
        <Text style={[styles.ratio, numeric, { color: colors.text }]}>{ratio.toFixed(2)}</Text>
        <View style={styles.heroCopy}>
          <Text style={[type.bodyMedium, { color: colors.textSecondary }]}>
            1 oz gold ≈ {ratio.toFixed(1)} oz silver
          </Text>
          <Text style={[styles.signalLine, { color: colors.muted }]} numberOfLines={2}>
            {signal.headline}
          </Text>
        </View>
      </View>

      <GoldSilverScale ratio={ratio} compact />

      <View style={[styles.prices, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.priceCell}>
          <Text style={[styles.priceLabel, { color: colors.muted }]}>Gold</Text>
          <Text style={[styles.priceValue, numeric, { color: colors.text }]}>
            {formatUsd(data.goldUsd)}
          </Text>
        </View>
        <View style={[styles.priceDivider, { backgroundColor: colors.border }]} />
        <View style={styles.priceCell}>
          <Text style={[styles.priceLabel, { color: colors.muted }]}>Silver</Text>
          <Text style={[styles.priceValue, numeric, { color: colors.text }]}>
            {formatUsd(data.silverUsd)}
          </Text>
        </View>
      </View>

      <View style={[styles.check, { borderTopColor: colors.border }]}>
        <Feather
          name={
            data.crossCheck.status === 'match'
              ? 'check-circle'
              : data.crossCheck.status === 'unavailable'
                ? 'help-circle'
                : 'alert-circle'
          }
          size={13}
          color={checkTone}
        />
        <View style={styles.checkText}>
          <Text style={[styles.checkTitle, { color: colors.text }]}>
            {checkSource} cross-check
          </Text>
          <Text style={[styles.checkDetail, { color: colors.muted }]} numberOfLines={1}>
            {crossCheckDetail}
          </Text>
        </View>
        <Badge label={check.label} tone={check.tone} />
      </View>
    </SignalCard>
  );
}

// Kept local so the compact card does not import the classifier twice.
const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  ratio: { fontSize: 36, lineHeight: 40, fontWeight: '600', letterSpacing: -1 },
  heroCopy: { flex: 1, gap: 2, paddingBottom: 3 },
  signalLine: { fontSize: 11, lineHeight: 15 },
  prices: {
    flexDirection: 'row',
    borderRadius: radius.md,
    paddingVertical: space.sm + 2,
    paddingHorizontal: space.md,
  },
  priceCell: { flex: 1, gap: 1 },
  priceDivider: { width: StyleSheet.hairlineWidth, marginHorizontal: space.md },
  priceLabel: { ...type.label, fontSize: 9, letterSpacing: 0.4 },
  priceValue: { fontSize: 15, fontWeight: '600' },
  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
  },
  checkText: { flex: 1, gap: 1 },
  checkTitle: { fontSize: 11.5, fontWeight: '600' },
  checkDetail: { fontSize: 10 },
  footerText: { fontSize: 10.5 },
  footerSub: { fontSize: 9.5, marginTop: 1 },
});
