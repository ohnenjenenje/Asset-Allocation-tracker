import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PeHistoryChart } from '@/src/components/charts/PeHistoryChart';
import { IndiaIndexPeCard } from '@/src/components/market/IndiaIndexPeCard';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { Skeleton } from '@/src/components/ui/Skeleton';
import { useIndiaPe } from '@/src/features/market/indiaPe';
import { useIndiaPeHistory } from '@/src/features/market/indiaPeHistory';
import { space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

/** Full India P/E signal, including history context and the sector drill-down. */
export default function IndiaPeDetailScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data } = useIndiaPe();
  const primary = data?.indices.find((index) => index.key === 'nifty50') ?? data?.indices[0] ?? null;
  const history = useIndiaPeHistory(primary?.key ?? null, Boolean(primary));

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Research signal"
        title="India index P/E"
        subtitle="Nifty 50 and featured indices against their own five-year history"
        leading={
          <IconButton
            icon="arrow-left"
            variant="plain"
            size={36}
            onPress={() => router.back()}
            accessibilityLabel="Back to Research"
          />
        }
      />

      <View style={styles.stack}>
        <IndiaIndexPeCard />

        <Card style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <View style={[styles.chartIcon, { backgroundColor: colors.cardMuted }]}>
              <Feather name="activity" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.chartHeaderText}>
              <Text style={[type.title, { color: colors.text }]}>Monthly P/E history</Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                {!primary
                  ? 'Waiting for valuations'
                  : history.isLoading && !history.data
                    ? `${primary.name} · loading monthly readings…`
                    : `${primary.name} · ${history.data?.months.length ?? 0} monthly readings`}
              </Text>
            </View>
          </View>

          {history.isLoading && !history.data ? (
            <Skeleton height={176} borderRadius={10} />
          ) : history.data ? (
            <PeHistoryChart
              months={history.data.months}
              medianPe={primary?.history?.medianPe ?? null}
              currentPe={primary?.pe ?? null}
            />
          ) : (
            <Text style={[styles.chartEmpty, { color: colors.muted }]}>
              {history.error instanceof Error
                ? history.error.message
                : 'Monthly history is unavailable right now.'}
            </Text>
          )}

          <Text style={[styles.chartNote, { color: colors.muted }]}>
            The shaded band is the 25th–75th percentile of the monthly readings. The dashed line
            is the five-year median. The current marker uses today’s P/E. The series comes from
            the same cached NSE archive as the percentile, not from a third-party chart page.
          </Text>
        </Card>

        <Card
          onPress={() => router.push('/research/sectors')}
          accessibilityLabel="Browse all sector and thematic valuations"
          style={styles.linkCard}
        >
          <View style={[styles.linkIcon, { backgroundColor: colors.accentSoft }]}>
            <Feather name="pie-chart" size={17} color={colors.accent} />
          </View>
          <View style={styles.linkText}>
            <Text style={[type.title, { color: colors.text }]}>Browse sector valuations</Text>
            <Text style={[type.caption, { color: colors.muted }]}>
              43 sector and thematic indices, plus the two broad benchmarks. Filter by zone,
              search, sort by percentile or discount, and expand any row for every metric.
            </Text>
          </View>
          <Feather name="chevron-right" size={17} color={colors.muted} />
        </Card>

        <Text style={[styles.note, { color: colors.muted }]}>
          A percentile is a relative valuation descriptor, not a standalone entry signal. It uses a
          five-year window and trailing P/E only; it does not model earnings quality, momentum or
          macro conditions. Treat “Buy zone” as valuation support for fresh buying, and “at cutoff”
          as a watch item.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  chartCard: { gap: space.md },
  chartHeader: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  chartIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartHeaderText: { flex: 1, gap: 2 },
  chartEmpty: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
  chartNote: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
  linkCard: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { flex: 1, gap: 3 },
  note: {
    ...type.caption,
    fontSize: 10.5,
    lineHeight: 15,
    paddingHorizontal: space.sm,
  },
});
