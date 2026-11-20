import { StyleSheet, Text, View } from 'react-native';

import { classifyPePercentile } from '@/src/features/market/peSignal';
import { radius, space } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface PePercentileScaleProps {
  percentile: number | null;
  compact?: boolean;
  /** Draw thin marks at the 25th and 75th percentile cutoffs. */
  showCutoffs?: boolean;
}

/** Shared 0–100 percentile band: cheap quartile, middle half, expensive quartile. */
export function PePercentileScale({
  percentile,
  compact = false,
  showCutoffs = false,
}: PePercentileScaleProps) {
  const { colors } = useTheme();
  const zone = classifyPePercentile(percentile);
  const zoneColor =
    zone === 'cheap' ? colors.positive : zone === 'expensive' ? colors.warning : colors.muted;
  const markerPosition = `${Math.min(Math.max(percentile ?? 0, 0), 100)}%` as `${number}%`;
  const trackHeight = compact ? 5 : 7;

  return (
    <View
      accessibilityLabel={
        percentile == null
          ? 'Valuation percentile unavailable'
          : `Valuation percentile ${Math.round(percentile)} out of 100`
      }
      style={styles.wrapper}
    >
      <View style={styles.trackWrapper}>
        <View style={[styles.track, { height: trackHeight }]}>
          <View style={[styles.segment, { flex: 25, backgroundColor: colors.positiveSoft }]} />
          <View style={[styles.segment, { flex: 50, backgroundColor: colors.cardMuted }]} />
          <View style={[styles.segment, { flex: 25, backgroundColor: colors.warningSoft }]} />
        </View>
        {showCutoffs ? (
          <>
            <View
              style={[
                styles.cutoff,
                { left: '25%', backgroundColor: colors.text, height: trackHeight + 6 },
              ]}
            />
            <View
              style={[
                styles.cutoff,
                { left: '75%', backgroundColor: colors.text, height: trackHeight + 6 },
              ]}
            />
          </>
        ) : null}
        {percentile != null ? (
          <View
            style={[
              styles.marker,
              {
                left: markerPosition,
                backgroundColor: zoneColor,
                height: trackHeight + 6,
              },
            ]}
          />
        ) : null}
      </View>
      <View style={styles.labels}>
        <Text
          style={[
            styles.label,
            compact && styles.compactLabel,
            { flex: 25, color: colors.positive },
          ]}
        >
          Cheap
        </Text>
        <Text
          style={[
            styles.label,
            styles.labelCenter,
            compact && styles.compactLabel,
            { flex: 50, color: colors.muted },
          ]}
        >
          Fair
        </Text>
        <Text
          style={[
            styles.label,
            styles.labelRight,
            compact && styles.compactLabel,
            { flex: 25, color: colors.warning },
          ]}
        >
          Expensive
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 0 },
  trackWrapper: { position: 'relative', justifyContent: 'center' },
  track: {
    flexDirection: 'row',
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  segment: { height: '100%' },
  cutoff: {
    position: 'absolute',
    top: '50%',
    width: StyleSheet.hairlineWidth,
    marginTop: -6,
    opacity: 0.35,
  },
  marker: {
    position: 'absolute',
    top: '50%',
    width: 3,
    borderRadius: 2,
    marginTop: -6,
    marginLeft: -1.5,
  },
  labels: { flexDirection: 'row', marginTop: space.xs + 1 },
  label: { fontSize: 9.5, fontWeight: '600' },
  compactLabel: { fontSize: 8.5 },
  labelCenter: { textAlign: 'center' },
  labelRight: { textAlign: 'right' },
});
