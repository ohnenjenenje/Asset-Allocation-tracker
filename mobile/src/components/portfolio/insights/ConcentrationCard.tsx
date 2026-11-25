import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/src/components/ui/Badge';
import type {
  StockConcentrationReport,
  StockConcentrationRow,
  StockConcentrationStatus,
} from '@/src/features/portfolio/concentration';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { AnalyticsCard } from './AnalyticsCard';

interface ConcentrationCardProps {
  report: StockConcentrationReport;
  /** Opens a directly held stock. Fund-only rows are not pressable. */
  onSelect?: (row: StockConcentrationRow) => void;
  /** Opens a fund asset from the per-stock source breakdown. */
  onSelectFund?: (assetId: string) => void;
  initialLimit?: number;
}

function percentWidth(value: number): `${number}%` {
  return `${Math.min(100, Math.max(0, value))}%`;
}

function statusLabel(status: StockConcentrationStatus): string {
  if (status === 'breach') return 'Above cap';
  if (status === 'watch') return 'Near cap';
  return 'Within';
}

/**
 * Stock-level concentration against the Equities sleeve. Each bar is split
 * into direct exposure and lighter fund look-through so a stock held in both
 * places reads as one line.
 */
export function ConcentrationCard({
  report,
  onSelect,
  onSelectFund,
  initialLimit = 6,
}: ConcentrationCardProps) {
  const { colors } = useTheme();
  const [showAll, setShowAll] = useState(false);

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
  const visible = showAll ? rows : rows.slice(0, initialLimit);
  const scaleMax = Math.max(
    limitPct * 1.5,
    (largest?.equityPercentage ?? 0) * 1.1,
    limitPct + 1,
  );
  const capLeft = percentWidth((limitPct / scaleMax) * 100);

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
                capLeft={capLeft}
                onSelect={onSelect}
                onSelectFund={onSelectFund}
              />
            ))}
          </View>

          {rows.length > initialLimit ? (
            <Pressable
              onPress={() => setShowAll((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={
                showAll ? 'Show fewer stocks' : `Show ${rows.length - initialLimit} more stocks`
              }
              style={styles.showAll}
            >
              <Text style={[styles.showAllText, { color: colors.accent }]}>
                {showAll ? 'Show less' : `Show ${rows.length - initialLimit} more`}
              </Text>
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

function ConcentrationRow({
  row,
  scaleMax,
  capLeft,
  onSelect,
  onSelectFund,
}: {
  row: StockConcentrationRow;
  scaleMax: number;
  capLeft: `${number}%`;
  onSelect?: (row: StockConcentrationRow) => void;
  onSelectFund?: (assetId: string) => void;
}) {
  const { colors } = useTheme();
  const [fundsOpen, setFundsOpen] = useState(false);
  const tone =
    row.status === 'breach'
      ? colors.negative
      : row.status === 'watch'
        ? colors.warning
        : colors.positive;
  const label = statusLabel(row.status);
  const width = percentWidth((row.equityPercentage / scaleMax) * 100);
  const pressable = Boolean(onSelect && row.assetId);

  const header = (
    <View style={styles.rowHeader}>
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
        {row.name}
      </Text>
      <Text style={[styles.percent, numeric, { color: tone }]}>
        {formatPercent(row.equityPercentage, { precision: 1 })}
      </Text>
      <Text style={[styles.status, { color: tone }]} numberOfLines={1}>
        {label}
      </Text>
      {pressable ? (
        <Feather name="chevron-right" size={13} color={colors.muted} />
      ) : null}
    </View>
  );

  const bar = (
    <View style={[styles.track, { backgroundColor: colors.cardMuted }]}>
      <View style={[styles.fill, { width }]}>
        {row.directValue > 0 ? (
          <View style={{ flex: row.directValue, backgroundColor: tone }} />
        ) : null}
        {row.fundValue > 0 ? (
          <View
            style={{ flex: row.fundValue, backgroundColor: tone, opacity: 0.38 }}
          />
        ) : null}
      </View>
      <View style={[styles.capLine, { left: capLeft, backgroundColor: colors.muted }]} />
    </View>
  );

  const accessibilityLabel = `${row.name}, ${formatPercent(
    row.equityPercentage,
    { precision: 1 },
  )} of equity, ${label}${
    row.directValue > 0 ? `, ${formatCompactINR(row.directValue)} direct` : ''
  }${row.fundValue > 0 ? `, ${formatCompactINR(row.fundValue)} via funds` : ''}${
    row.funds.length > 0
      ? `, held via ${row.funds.length} ${
          row.funds.length === 1 ? 'fund' : 'funds'
        }`
      : ''
  }`;

  return (
    <View style={styles.row}>
      {pressable ? (
        <Pressable
          onPress={() => onSelect?.(row)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        >
          {header}
          {bar}
        </Pressable>
      ) : (
        <View style={styles.rowMain}>
          {header}
          {bar}
        </View>
      )}

      <View style={styles.metaRow}>
        <Text
          style={[styles.meta, numeric, { color: colors.muted }]}
          numberOfLines={1}
        >
          {row.directValue > 0 && row.fundValue > 0
            ? `${formatCompactINR(row.directValue)} direct · ${formatCompactINR(
                row.fundValue,
              )} via funds`
            : row.fundValue > 0
              ? `${formatCompactINR(row.fundValue)} via funds`
              : `${formatCompactINR(row.directValue)} direct`}
        </Text>
        {row.funds.length > 0 ? (
          <Pressable
            onPress={() => setFundsOpen((value) => !value)}
            accessibilityRole="button"
            accessibilityState={{ expanded: fundsOpen }}
            accessibilityLabel={`${fundsOpen ? 'Hide' : 'Show'} funds holding ${row.name}`}
            hitSlop={8}
            style={styles.fundToggle}
          >
            <Text style={[styles.fundToggleText, { color: colors.accent }]}>
              {row.funds.length} {row.funds.length === 1 ? 'fund' : 'funds'}
            </Text>
            <Feather
              name={fundsOpen ? 'chevron-up' : 'chevron-down'}
              size={12}
              color={colors.accent}
            />
          </Pressable>
        ) : null}
      </View>

      {fundsOpen && row.funds.length > 0 ? (
        <View style={[styles.fundList, { borderTopColor: colors.border }]}>
          <Text style={[styles.fundListLabel, { color: colors.muted }]}>
            Held via funds · % of fund
          </Text>
          {row.funds.slice(0, 8).map((fund) => {
            const weight =
              fund.fundValue > 0 ? (fund.value / fund.fundValue) * 100 : 0;
            const canOpen = Boolean(onSelectFund && fund.assetId);
            const fundContent = (
              <View style={styles.fundRow}>
                <Text
                  style={[styles.fundName, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {fund.name}
                </Text>
                <Text style={[styles.fundWeight, numeric, { color: colors.muted }]}>
                  {fund.fundValue > 0
                    ? formatPercent(weight, { precision: 1 })
                    : '—'}
                </Text>
                <Text
                  style={[styles.fundValue, numeric, { color: colors.textSecondary }]}
                >
                  {formatCompactINR(fund.value)}
                </Text>
                {canOpen ? (
                  <Feather name="chevron-right" size={11} color={colors.muted} />
                ) : null}
              </View>
            );

            if (!canOpen) {
              return <View key={fund.key}>{fundContent}</View>;
            }

            return (
              <Pressable
                key={fund.key}
                onPress={() => {
                  if (fund.assetId) onSelectFund?.(fund.assetId);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${fund.name}, ${formatPercent(weight, {
                  precision: 1,
                })} of the fund, ${formatCompactINR(fund.value)} of this stock`}
                style={({ pressed }) => [pressed && styles.pressed]}
              >
                {fundContent}
              </Pressable>
            );
          })}
          {row.funds.length > 8 ? (
            <Text style={[styles.fundMore, { color: colors.muted }]}>
              +{row.funds.length - 8} more funds
            </Text>
          ) : null}
        </View>
      ) : null}
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
  row: { gap: 5 },
  rowMain: { gap: 5 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  name: { flex: 1, fontSize: 12, fontWeight: '600' },
  percent: { width: 46, fontSize: 11, fontWeight: '600', textAlign: 'right' },
  status: { width: 58, fontSize: 9, fontWeight: '600', textAlign: 'right' },
  track: {
    height: 7,
    borderRadius: radius.full,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: { flexDirection: 'row', height: '100%', borderRadius: radius.full, overflow: 'hidden' },
  capLine: { position: 'absolute', top: 0, bottom: 0, width: 1.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  meta: { flex: 1, fontSize: 9.5 },
  fundToggle: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  fundToggleText: { fontSize: 9.5, fontWeight: '600' },
  fundList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
    paddingTop: space.xs,
    gap: 3,
  },
  fundListLabel: { ...type.label, fontSize: 8.5, letterSpacing: 0.4 },
  fundRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 1 },
  fundName: { flex: 1, fontSize: 10 },
  fundWeight: { width: 42, fontSize: 9.5, textAlign: 'right' },
  fundValue: { width: 56, fontSize: 9.5, textAlign: 'right' },
  fundMore: { fontSize: 9 },
  pressed: { opacity: 0.7 },
  showAll: { alignSelf: 'flex-start', paddingVertical: 2 },
  showAllText: { fontSize: 12, fontWeight: '600' },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  swatch: { width: 9, height: 5, borderRadius: 2 },
  capKey: { width: 1.5, height: 9, borderRadius: 1 },
  legendText: { fontSize: 9.5 },
  footerStack: { gap: 3 },
  footerText: { fontSize: 10, lineHeight: 15 },
});
