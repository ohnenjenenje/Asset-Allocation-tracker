import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import type {
  StockConcentrationReport,
  StockConcentrationRow,
} from '@/src/features/portfolio/concentration';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { AnalyticsCard } from './AnalyticsCard';
import { ConcentrationRow } from './ConcentrationRow';

interface ConcentrationCardProps {
  report: StockConcentrationReport;
  /** Opens a directly held stock. Fund-only rows are not pressable. */
  onSelect?: (row: StockConcentrationRow) => void;
  /** Opens a fund asset from the per-stock source breakdown. */
  onSelectFund?: (assetId: string) => void;
  /** Opens the full, searchable concentration screen. */
  onViewAll?: () => void;
  initialLimit?: number;
}

/**
 * Stock-level concentration against the Equities sleeve. The Insights tab
 * stays a top-ten preview — the full list lives on its own screen so 400+
 * positions do not turn this page into an endless scroll. Each bar is split
 * into direct exposure and lighter fund look-through so a stock held in both
 * places reads as one line.
 */
export function ConcentrationCard({
  report,
  onSelect,
  onSelectFund,
  onViewAll,
  initialLimit = 10,
}: ConcentrationCardProps) {
  const { colors } = useTheme();

  const {
    rows,
    limitPct,
    breachCount,
    watchCount,
    largest,
    coverage,
    equityValue,
    directValue,
    fundValue,
    otherEquityValue,
  } = report;
  const visible = rows.slice(0, initialLimit);
  const scaleMax = Math.max(
    limitPct * 1.5,
    (largest?.equityPercentage ?? 0) * 1.1,
    limitPct + 1,
  );
  const previewRows = rows.slice(0, 10);
  const previewShare =
    equityValue > 0
      ? (previewRows.reduce((sum, row) => sum + row.totalValue, 0) / equityValue) * 100
      : 0;

  const trailing =
    rows.length === 0 ? null : breachCount > 0 ? (
      <Badge label={`${breachCount} above cap`} tone="negative" />
    ) : watchCount > 0 ? (
      <Badge label={`${watchCount} near cap`} tone="warning" />
    ) : (
      <Badge label="All within cap" tone="positive" />
    );

  const footer = (
    <View style={styles.footerStack}>
      <Text style={[styles.footerText, { color: colors.muted }]}>
        Measured against {formatCompactINR(equityValue)} of equity exposure.
      </Text>
      {coverage.total > 0 ? (
        <Text style={[styles.footerText, { color: colors.muted }]}>
          {`Look-through covers ${coverage.withData} of ${coverage.total} ${
            coverage.total === 1 ? 'fund' : 'funds'
          } with equity exposure.`}
          {coverage.withData < coverage.total
            ? ' Undisclosed holdings may add concentration.'
            : ''}
        </Text>
      ) : null}
      {otherEquityValue > 0 ? (
        <Text style={[styles.footerText, { color: colors.muted }]}>
          Other equity covers undisclosed fund holdings and equity not attributed to
          a single stock.
        </Text>
      ) : null}
    </View>
  );

  return (
    <AnalyticsCard
      icon="bar-chart-2"
      title="Single-stock concentration"
      subtitle={`Share of equity · ${limitPct}% cap`}
      tint="#DB2777"
      tintSoft="rgba(219, 39, 119, 0.12)"
      trailing={trailing}
      footer={footer}
    >
      {rows.length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>
          {coverage.total > 0
            ? 'No stock positions are disclosed yet. Direct stocks and fund look-through will appear here.'
            : 'Add a stock, or sync a fund with disclosed holdings, to measure single-stock concentration.'}
        </Text>
      ) : (
        <View style={styles.body}>
          {largest ? (
            <Text style={[styles.lead, { color: colors.textSecondary }]}>
              Largest:{' '}
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {largest.name}
              </Text>{' '}
              — {formatPercent(largest.equityPercentage, { precision: 1 })} of equity
            </Text>
          ) : null}

          <View style={[styles.sourceStrip, { backgroundColor: colors.cardMuted }]}>
            <SourceStat
              label="Direct"
              value={directValue}
              equityValue={equityValue}
              dotStyle={{ backgroundColor: colors.muted }}
            />
            <View style={[styles.sourceDivider, { backgroundColor: colors.border }]} />
            <SourceStat
              label="Via funds"
              value={fundValue}
              equityValue={equityValue}
              dotStyle={{ backgroundColor: colors.muted, opacity: 0.38 }}
            />
            <View style={[styles.sourceDivider, { backgroundColor: colors.border }]} />
            <SourceStat
              label="Other equity"
              value={otherEquityValue}
              equityValue={equityValue}
              dotStyle={{ borderWidth: 1, borderColor: colors.muted }}
            />
          </View>

          <View style={styles.rows}>
            {visible.map((row) => (
              <ConcentrationRow
                key={row.key}
                row={row}
                scaleMax={scaleMax}
                limitPct={limitPct}
                onSelect={onSelect}
                onSelectFund={onSelectFund}
              />
            ))}
          </View>

          {onViewAll && rows.length > initialLimit ? (
            <Pressable
              onPress={onViewAll}
              accessibilityRole="button"
              accessibilityLabel={`View all ${rows.length} stocks`}
              style={({ pressed }) => [
                styles.viewAll,
                {
                  backgroundColor: colors.cardMuted,
                  borderColor: colors.border,
                },
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.viewAllText}>
                <Text style={[styles.viewAllTitle, { color: colors.text }]}>
                  View all {rows.length} stocks
                </Text>
                <Text
                  style={[styles.viewAllHint, { color: colors.muted }]}
                  numberOfLines={1}
                >
                  Top {previewRows.length} ={' '}
                  {formatPercent(previewShare, { precision: 1 })} of equity · search,
                  filter and sort
                </Text>
              </View>
              <Feather name="arrow-right" size={15} color={colors.accent} />
            </Pressable>
          ) : null}

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: colors.muted }]} />
              <Text style={[styles.legendText, { color: colors.muted }]}>Direct</Text>
            </View>
            <View style={styles.legendItem}>
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: colors.muted, opacity: 0.38 },
                ]}
              />
              <Text style={[styles.legendText, { color: colors.muted }]}>Via funds</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.capKey, { backgroundColor: colors.muted }]} />
              <Text style={[styles.legendText, { color: colors.muted }]}>
                {limitPct}% cap
              </Text>
            </View>
          </View>
        </View>
      )}
    </AnalyticsCard>
  );
}

function SourceStat({
  label,
  value,
  equityValue,
  dotStyle,
}: {
  label: string;
  value: number;
  equityValue: number;
  dotStyle: { backgroundColor?: string; opacity?: number; borderWidth?: number; borderColor?: string };
}) {
  const { colors } = useTheme();
  const percentage = equityValue > 0 ? (value / equityValue) * 100 : 0;

  return (
    <View style={styles.sourceStat}>
      <View style={styles.sourceLabelRow}>
        <View style={[styles.sourceDot, dotStyle]} />
        <Text style={[styles.sourceLabel, { color: colors.muted }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text
        style={[styles.sourceValue, numeric, { color: colors.text }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.72}
      >
        {formatCompactINR(value)}
      </Text>
      <Text style={[styles.sourceHint, { color: colors.muted }]} numberOfLines={1}>
        {formatPercent(percentage, { precision: 1 })} of equity
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  empty: { ...type.body, paddingVertical: space.xl, textAlign: 'center' },
  lead: { ...type.caption, lineHeight: 17 },
  sourceStrip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.xs,
  },
  sourceStat: { flex: 1, gap: 2, paddingHorizontal: space.xs },
  sourceLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceDot: { width: 7, height: 7, borderRadius: 3.5 },
  sourceLabel: { ...type.label, fontSize: 8.5, letterSpacing: 0.2, flex: 1 },
  sourceValue: { fontSize: 12, fontWeight: '600' },
  sourceHint: { fontSize: 8.5 },
  sourceDivider: { width: StyleSheet.hairlineWidth, marginVertical: 2 },
  rows: { gap: space.md },
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  viewAllText: { flex: 1, gap: 2 },
  viewAllTitle: { fontSize: 12, fontWeight: '600' },
  viewAllHint: { fontSize: 9.5 },
  pressed: { opacity: 0.7 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  swatch: { width: 9, height: 5, borderRadius: 2 },
  capKey: { width: 1.5, height: 9, borderRadius: 1 },
  legendText: { fontSize: 9.5 },
  footerStack: { gap: 3 },
  footerText: { fontSize: 10, lineHeight: 15 },
});
