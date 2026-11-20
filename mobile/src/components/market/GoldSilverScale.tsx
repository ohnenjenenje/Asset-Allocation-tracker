import { StyleSheet, Text, View } from 'react-native';

import { radius, space } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

// The scale is a view, not a data range: clamp extreme readings to the edges.
const SCALE_MIN = 40;
const SCALE_MAX = 100;

function scalePosition(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  const clamped = Math.min(Math.max(ratio, SCALE_MIN), SCALE_MAX);
  return ((clamped - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100;
}

interface GoldSilverScaleProps {
  ratio: number;
  compact?: boolean;
}

/** 40–100 ratio band: gold below 50, balanced 50–80, silver above 80. */
export function GoldSilverScale({ ratio, compact = false }: GoldSilverScaleProps) {
  const { colors } = useTheme();
  const markerPosition = `${scalePosition(ratio)}%` as `${number}%`;
  const trackHeight = compact ? 5 : 6;

  return (
    <View
      accessibilityLabel={`Gold silver ratio ${ratio.toFixed(2)} on a 40 to 100 scale`}
      style={styles.wrapper}
    >
      <View style={styles.trackWrapper}>
        <View
          style={[
            styles.track,
            { height: trackHeight, backgroundColor: colors.border },
          ]}
        >
          <View style={[styles.segment, { flex: 10, backgroundColor: colors.warningSoft }]} />
          <View style={[styles.segment, { flex: 30, backgroundColor: colors.border }]} />
          <View style={[styles.segment, { flex: 20, backgroundColor: colors.accentSoft }]} />
        </View>
        <View
          style={[
            styles.marker,
            {
              left: markerPosition,
              height: trackHeight + 6,
              backgroundColor: colors.text,
            },
          ]}
        />
      </View>
      <View style={styles.labels}>
        <Text
          style={[
            styles.label,
            compact && styles.compactLabel,
            { flex: 10, color: colors.warning },
          ]}
        >
          Gold
        </Text>
        <Text
          style={[
            styles.label,
            styles.labelCenter,
            compact && styles.compactLabel,
            { flex: 30, color: colors.muted },
          ]}
        >
          Balanced
        </Text>
        <Text
          style={[
            styles.label,
            styles.labelRight,
            compact && styles.compactLabel,
            { flex: 20, color: colors.accent },
          ]}
        >
          Silver
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
  marker: {
    position: 'absolute',
    top: '50%',
    width: 3,
    borderRadius: 2,
    marginTop: -6,
    marginLeft: -1.5,
  },
  labels: { flexDirection: 'row', marginTop: space.xs + 1 },
  label: { fontSize: 9, fontWeight: '600' },
  compactLabel: { fontSize: 8.5 },
  labelCenter: { textAlign: 'center' },
  labelRight: { textAlign: 'right' },
});
