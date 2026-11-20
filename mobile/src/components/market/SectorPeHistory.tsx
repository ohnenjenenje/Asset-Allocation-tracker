import { StyleSheet, Text, View } from 'react-native';

import { PeHistoryChart } from '@/src/components/charts/PeHistoryChart';
import { Skeleton } from '@/src/components/ui/Skeleton';
import type { IndiaIndexValuation } from '@/src/features/market/indiaPe';
import { useIndiaPeHistory } from '@/src/features/market/indiaPeHistory';
import { space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface SectorPeHistoryProps {
  index: IndiaIndexValuation;
}

/**
 * On-demand monthly chart for one expanded sector row. The request is only made
 * when the row is open, so a 45-row screen never fires 45 chart queries.
 */
export function SectorPeHistory({ index }: SectorPeHistoryProps) {
  const { colors } = useTheme();
  const { data, error, isLoading } = useIndiaPeHistory(index.key);

  if (index.history == null) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.cardMuted }]}>
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          No monthly history is available for this index yet, so there is no chart to draw.
        </Text>
      </View>
    );
  }

  if (isLoading && !data) {
    return <Skeleton height={140} borderRadius={10} />;
  }

  if (!data || data.months.length < 2) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.cardMuted }]}>
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          {error instanceof Error
            ? error.message
            : 'The monthly chart is unavailable right now.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.wrapper}>
      <PeHistoryChart
        months={data.months}
        medianPe={index.history?.medianPe ?? null}
        currentPe={index.pe}
        compact
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space.xs },
  empty: { borderRadius: 10, padding: space.md },
  emptyText: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
});
