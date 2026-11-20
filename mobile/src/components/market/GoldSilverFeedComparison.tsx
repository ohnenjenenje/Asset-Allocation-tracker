import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import { Card } from '@/src/components/ui/Card';
import {
  crossCheckView,
  formatQuoteTime,
  formatUsd,
  goldSilverSourceLabel,
} from '@/src/features/market/goldSilverFormat';
import type { GoldSilverData } from '@/src/features/market/goldSilver';
import { formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface GoldSilverFeedComparisonProps {
  data: GoldSilverData;
}

function FeedBlock({
  title,
  subtitle,
  quote,
  primary,
}: {
  title: string;
  subtitle: string;
  quote: GoldSilverData['yahoo'];
  primary: boolean;
}) {
  const { colors } = useTheme();

  if (!quote) {
    return (
      <View style={[styles.feed, { backgroundColor: colors.cardMuted }]}>
        <View style={styles.feedHeader}>
          <View style={styles.feedTitle}>
            <Text style={[styles.feedName, { color: colors.text }]}>{title}</Text>
            <Text style={[styles.feedSubtitle, { color: colors.muted }]}>{subtitle}</Text>
          </View>
          <Badge label="Unavailable" tone="neutral" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.feed, { backgroundColor: colors.cardMuted }]}>
      <View style={styles.feedHeader}>
        <View style={styles.feedTitle}>
          <Text style={[styles.feedName, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.feedSubtitle, { color: colors.muted }]}>{subtitle}</Text>
        </View>
        <Badge label={primary ? 'Primary' : 'Independent'} tone={primary ? 'accent' : 'neutral'} />
      </View>
      <View style={styles.feedGrid}>
        <View style={styles.feedCell}>
          <Text style={[styles.feedLabel, { color: colors.muted }]}>Gold</Text>
          <Text style={[styles.feedValue, numeric, { color: colors.text }]}>
            {formatUsd(quote.goldUsd)}
          </Text>
        </View>
        <View style={styles.feedCell}>
          <Text style={[styles.feedLabel, { color: colors.muted }]}>Silver</Text>
          <Text style={[styles.feedValue, numeric, { color: colors.text }]}>
            {formatUsd(quote.silverUsd)}
          </Text>
        </View>
        <View style={styles.feedCell}>
          <Text style={[styles.feedLabel, { color: colors.muted }]}>Ratio</Text>
          <Text style={[styles.feedValue, numeric, { color: colors.text }]}>
            {quote.ratio != null ? quote.ratio.toFixed(2) : '—'}
          </Text>
        </View>
      </View>
      <Text style={[styles.feedTime, { color: colors.muted }]}>
        {formatQuoteTime(quote.asOf)}
        {quote.stale ? ' · last known' : ''}
      </Text>
    </View>
  );
}

/**
 * Full two-feed table for the detail screen. The compact card only shows the
 * primary quote and the cross-check status; this view exposes both feeds.
 */
export function GoldSilverFeedComparison({ data }: GoldSilverFeedComparisonProps) {
  const { colors } = useTheme();
  const check = crossCheckView(data.crossCheck.status);
  const difference =
    data.crossCheck.differencePct != null
      ? `${formatPercent(data.crossCheck.differencePct)} apart`
      : 'difference unavailable';

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: colors.cardMuted }]}>
          <Feather name="layers" size={16} color={colors.textSecondary} />
        </View>
        <View style={styles.headerText}>
          <Text style={[type.title, { color: colors.text }]}>Feed comparison</Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            {goldSilverSourceLabel(data.primarySource)} is primary · {difference}
          </Text>
        </View>
        <Badge label={check.label} tone={check.tone} />
      </View>

      <FeedBlock
        title="Yahoo COMEX futures"
        subtitle="Front-month futures"
        quote={data.yahoo}
        primary={data.primarySource === 'yahoo'}
      />
      <FeedBlock
        title="xaus.com spot"
        subtitle="Independent spot quote"
        quote={data.xaus}
        primary={data.primarySource === 'xaus'}
      />

      <View style={[styles.summary, { borderTopColor: colors.border }]}>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Cross-check difference</Text>
          <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>{difference}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Tolerance</Text>
          <Text style={[styles.summaryValue, numeric, { color: colors.text }]}>
            {formatPercent(data.crossCheck.tolerancePct)}
          </Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.muted }]}>Primary source</Text>
          <Text style={[styles.summaryValue, { color: colors.text }]}>
            {goldSilverSourceLabel(data.primarySource)}
          </Text>
        </View>
      </View>

      <Text style={[styles.note, { color: colors.muted }]}>
        The signal uses the primary quote. A difference above the tolerance marks the feeds as
        divergent, not the signal as invalid. If one feed is unavailable, the other still supplies
        a quote and the comparison is marked accordingly.
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
  feed: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  feedHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.sm },
  feedTitle: { flex: 1, gap: 1 },
  feedName: { fontSize: 12.5, fontWeight: '600' },
  feedSubtitle: { fontSize: 10 },
  feedGrid: { flexDirection: 'row', gap: space.md },
  feedCell: { flex: 1, gap: 1 },
  feedLabel: { ...type.label, fontSize: 8.5, letterSpacing: 0.4 },
  feedValue: { fontSize: 13.5, fontWeight: '600' },
  feedTime: { fontSize: 9.5 },
  summary: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: space.xs },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  summaryLabel: { fontSize: 11 },
  summaryValue: { fontSize: 11, fontWeight: '600' },
  note: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
});
