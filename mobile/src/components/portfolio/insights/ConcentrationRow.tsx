import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  StockConcentrationRow,
  StockConcentrationStatus,
} from '@/src/features/portfolio/concentration';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

export function percentWidth(value: number): `${number}%` {
  return `${Math.min(100, Math.max(0, value))}%`;
}

export function statusLabel(status: StockConcentrationStatus): string {
  if (status === 'breach') return 'Above cap';
  if (status === 'watch') return 'Near cap';
  return 'Within';
}

interface ConcentrationRowProps {
  row: StockConcentrationRow;
  /** Denominator for the bar; keeps every row on the same scale. */
  scaleMax: number;
  /** Cap line position as a percentage of `scaleMax`. */
  limitPct: number;
  /** Opens a directly held stock. Fund-only rows are not pressable. */
  onSelect?: (row: StockConcentrationRow) => void;
  /** Opens a fund asset from the per-stock source breakdown. */
  onSelectFund?: (assetId: string) => void;
  /** Fund rows shown before "Show all funds". */
  maxFunds?: number;
}

/**
 * One stock exposure line. Used by the Insights preview and the full
 * concentration screen so both read the same way: direct vs fund look-through
 * inside one bar, with the fund sources available on demand.
 */
export function ConcentrationRow({
  row,
  scaleMax,
  limitPct,
  onSelect,
  onSelectFund,
  maxFunds = 8,
}: ConcentrationRowProps) {
  const { colors } = useTheme();
  const [fundsOpen, setFundsOpen] = useState(false);
  const [allFunds, setAllFunds] = useState(false);

  const tone =
    row.status === 'breach'
      ? colors.negative
      : row.status === 'watch'
        ? colors.warning
        : colors.positive;
  const label = statusLabel(row.status);
  const width = percentWidth((row.equityPercentage / scaleMax) * 100);
  const capLeft = percentWidth((limitPct / scaleMax) * 100);
  const pressable = Boolean(onSelect && row.assetId);
  const visibleFunds = allFunds ? row.funds : row.funds.slice(0, maxFunds);

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
          {visibleFunds.map((fund) => {
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
          {row.funds.length > maxFunds ? (
            <Pressable
              onPress={() => setAllFunds((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={
                allFunds
                  ? `Show fewer funds holding ${row.name}`
                  : `Show all ${row.funds.length} funds holding ${row.name}`
              }
              hitSlop={6}
            >
              <Text style={[styles.fundMore, { color: colors.accent }]}>
                {allFunds
                  ? 'Show fewer funds'
                  : `Show all ${row.funds.length} funds`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  fill: {
    flexDirection: 'row',
    height: '100%',
    borderRadius: radius.full,
    overflow: 'hidden',
  },
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
  fundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 1,
  },
  fundName: { flex: 1, fontSize: 10 },
  fundWeight: { width: 42, fontSize: 9.5, textAlign: 'right' },
  fundValue: { width: 56, fontSize: 9.5, textAlign: 'right' },
  fundMore: { fontSize: 9, fontWeight: '600' },
  pressed: { opacity: 0.7 },
});
