import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, {
  Circle,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from 'react-native-svg';

import type { IndiaPeHistoryPoint } from '@/src/features/market/indiaPeHistory';
import { space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface PeHistoryChartProps {
  months: IndiaPeHistoryPoint[];
  medianPe: number | null;
  currentPe: number | null;
  compact?: boolean;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = sorted[base + 1];
  return next == null ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

function monthLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  if (Number.isNaN(date.getTime())) return value;
  try {
    return date.toLocaleDateString('en-IN', {
      month: 'short',
      year: '2-digit',
      timeZone: 'UTC',
    });
  } catch {
    return value;
  }
}

/**
 * Screener.in-style index P/E chart built from our own monthly series: the P/E
 * line, a flat five-year median, the 25th–75th percentile band and the current
 * reading. No third-party page is scraped.
 */
export function PeHistoryChart({
  months,
  medianPe,
  currentPe,
  compact = false,
}: PeHistoryChartProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const height = compact ? 140 : 176;
  const padding = { left: 36, right: 12, top: 12, bottom: 22 };

  if (months.length < 2) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.cardMuted }]}>
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          Not enough monthly readings to draw a chart yet.
        </Text>
      </View>
    );
  }

  const values = months.map((point) => point.pe);
  const sorted = [...values].sort((a, b) => a - b);
  const q25 = quantile(sorted, 0.25);
  const q75 = quantile(sorted, 0.75);
  const domain = [
    ...values,
    ...(medianPe != null ? [medianPe] : []),
    ...(currentPe != null ? [currentPe] : []),
  ];
  const rawMin = Math.min(...domain);
  const rawMax = Math.max(...domain);
  const spread = rawMax - rawMin;
  const pad = spread > 0 ? spread * 0.08 : Math.max(rawMax * 0.05, 1);
  const yMin = Math.max(0, rawMin - pad);
  const yMax = rawMax + pad;
  const plotWidth = Math.max(width - padding.left - padding.right, 1);
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number) =>
    padding.left + (plotWidth * index) / Math.max(months.length - 1, 1);
  const y = (value: number) =>
    padding.top + plotHeight - ((value - yMin) / Math.max(yMax - yMin, 0.0001)) * plotHeight;

  const linePath = months
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)} ${y(point.pe).toFixed(2)}`)
    .join(' ');
  const medianY = medianPe != null ? y(medianPe) : null;
  const currentY = currentPe != null ? y(currentPe) : null;
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];

  return (
    <View style={styles.wrapper}>
      <View
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          if (next !== width) setWidth(next);
        }}
        style={{ height }}
        accessibilityLabel={`P/E history with ${months.length} monthly readings, median ${
          medianPe != null ? medianPe.toFixed(2) : 'unavailable'
        }, current ${currentPe != null ? currentPe.toFixed(2) : 'unavailable'}`}
      >
        {width > 0 ? (
          <Svg width={width} height={height}>
            <Rect
              x={padding.left}
              y={y(q75)}
              width={plotWidth}
              height={Math.max(y(q25) - y(q75), 1)}
              fill={colors.accentSoft}
            />
            {medianY != null ? (
              <Line
                x1={padding.left}
                y1={medianY}
                x2={padding.left + plotWidth}
                y2={medianY}
                stroke={colors.muted}
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            ) : null}
            <Path d={linePath} fill="none" stroke={colors.accent} strokeWidth={2} />
            {currentY != null ? (
              <>
                <Line
                  x1={padding.left}
                  y1={currentY}
                  x2={padding.left + plotWidth}
                  y2={currentY}
                  stroke={colors.text}
                  strokeWidth={0.75}
                  strokeDasharray="2 4"
                  opacity={0.45}
                />
                <Circle
                  cx={padding.left + plotWidth}
                  cy={currentY}
                  r={3.5}
                  fill={colors.accent}
                  stroke={colors.card}
                  strokeWidth={1.5}
                />
                <SvgText
                  x={padding.left + plotWidth - 2}
                  y={currentY - 7}
                  fontSize={8}
                  fontWeight="600"
                  fill={colors.text}
                  textAnchor="end"
                >
                  Now {currentPe?.toFixed(1)}
                </SvgText>
              </>
            ) : null}
            <SvgText
              x={padding.left - 6}
              y={padding.top + 4}
              fontSize={8}
              fill={colors.muted}
              textAnchor="end"
            >
              {yMax.toFixed(1)}
            </SvgText>
            <SvgText
              x={padding.left - 6}
              y={padding.top + plotHeight}
              fontSize={8}
              fill={colors.muted}
              textAnchor="end"
            >
              {yMin.toFixed(1)}
            </SvgText>
            {medianY != null && medianPe != null ? (
              <SvgText
                x={padding.left - 6}
                y={medianY + 3}
                fontSize={8}
                fontWeight="600"
                fill={colors.muted}
                textAnchor="end"
              >
                {medianPe.toFixed(1)}
              </SvgText>
            ) : null}
            <SvgText
              x={padding.left}
              y={height - 5}
              fontSize={8}
              fill={colors.muted}
              textAnchor="start"
            >
              {monthLabel(firstMonth.month)}
            </SvgText>
            <SvgText
              x={padding.left + plotWidth}
              y={height - 5}
              fontSize={8}
              fill={colors.muted}
              textAnchor="end"
            >
              {monthLabel(lastMonth.month)}
            </SvgText>
          </Svg>
        ) : null}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendLine, { backgroundColor: colors.accent }]} />
          <Text style={[styles.legendLabel, { color: colors.muted }]}>P/E</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDash, { borderTopColor: colors.muted }]} />
          <Text style={[styles.legendLabel, { color: colors.muted }]}>Median</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendBand, { backgroundColor: colors.accentSoft }]} />
          <Text style={[styles.legendLabel, { color: colors.muted }]}>25th–75th pct</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: space.xs },
  empty: {
    borderRadius: 10,
    padding: space.md,
    alignItems: 'center',
  },
  emptyText: { ...type.caption, fontSize: 10.5, textAlign: 'center' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingTop: space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLine: { width: 14, height: 2, borderRadius: 1 },
  legendDash: { width: 14, borderTopWidth: 1, borderStyle: 'dashed' },
  legendBand: { width: 14, height: 7, borderRadius: 2 },
  legendLabel: { fontSize: 9 },
});
