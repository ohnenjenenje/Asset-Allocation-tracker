import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { capDisplayLabel, type CapSectorRow } from '@/src/features/portfolio/analytics';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { AnalyticsCard } from './AnalyticsCard';

interface SectorCapBarsProps {
  rows: CapSectorRow[];
  allSectors: string[];
  sectorColors: Record<string, string>;
  capColors: Record<string, string>;
}

interface SectorBreakdown {
  sector: string;
  total: number;
  caps: { cap: string; value: number }[];
}

/**
 * Sector-first view of the cap matrix: every sector's bar is split by cap
 * segment, exposing concentration inside each sector.
 */
export function SectorCapBars({
  rows,
  allSectors,
  sectorColors,
  capColors,
}: SectorCapBarsProps) {
  const { colors } = useTheme();
  const [showAll, setShowAll] = useState(false);

  const breakdown = new Map<string, SectorBreakdown>();
  for (const row of rows) {
    for (const sector of row.sectors) {
      const existing = breakdown.get(sector.sector);
      if (existing) {
        existing.total += sector.value;
        existing.caps.push({ cap: row.cap, value: sector.value });
      } else {
        breakdown.set(sector.sector, {
          sector: sector.sector,
          total: sector.value,
          caps: [{ cap: row.cap, value: sector.value }],
        });
      }
    }
  }

  for (const sector of allSectors) {
    if (!breakdown.has(sector)) {
      breakdown.set(sector, { sector, total: 0, caps: [] });
    }
  }

  const sectors = [...breakdown.values()]
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);
  const total = sectors.reduce((sum, entry) => sum + entry.total, 0);
  const visible = showAll ? sectors : sectors.slice(0, 8);
  const hidden = sectors.length - visible.length;

  return (
    <AnalyticsCard
      icon="bar-chart-2"
      title="Sector Distribution across Market Caps"
      subtitle="Each sector split by cap band"
      footer={
        <View style={styles.footerRow}>
          <Text style={[styles.footerLabel, { color: colors.muted }]}>Sectors covered</Text>
          <Text style={[styles.footerValue, numeric, { color: colors.text }]}>
            {sectors.length}
          </Text>
        </View>
      }
    >
      {sectors.length === 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>
          Add equities or mapped funds to see sector distribution.
        </Text>
      ) : (
        <>
          <View style={styles.capLegend}>
            {rows.map((row) => (
              <View key={row.cap} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendDot,
                    { backgroundColor: capColors[row.cap] ?? colors.textSecondary },
                  ]}
                />
                <Text style={[styles.legendText, { color: colors.muted }]} numberOfLines={1}>
                  {capDisplayLabel(row.cap)}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.list}>
            {visible.map((entry) => {
              const sectorPercent = total > 0 ? (entry.total / total) * 100 : 0;
              const sectorColor = sectorColors[entry.sector] ?? colors.textSecondary;

              return (
                <View key={entry.sector} style={styles.row}>
                  <View style={styles.rowHeader}>
                    <View style={[styles.dot, { backgroundColor: sectorColor }]} />
                    <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                      {entry.sector}
                    </Text>
                    <Text style={[styles.value, numeric, { color: colors.textSecondary }]}>
                      {formatCompactINR(entry.total)}
                    </Text>
                    <Text style={[styles.percent, numeric, { color: colors.muted }]}>
                      {formatPercent(sectorPercent)}
                    </Text>
                  </View>

                  <View
                    style={[styles.track, { backgroundColor: colors.cardMuted }]}
                    accessibilityRole="image"
                    accessibilityLabel={`${entry.sector} split across market caps`}
                  >
                    {entry.caps.map((cap) => {
                      const capValue = cap.value;
                      return (
                        <View
                          key={cap.cap}
                          style={{
                            flex: capValue,
                            backgroundColor: capColors[cap.cap] ?? sectorColor,
                            height: '100%',
                          }}
                        />
                      );
                    })}
                  </View>

                  <View style={styles.capLabels}>
                    {entry.caps.map((cap) => (
                      <View key={cap.cap} style={styles.capLabel}>
                        <View
                          style={[
                            styles.capDot,
                            {
                              backgroundColor:
                                capColors[cap.cap] ?? colors.textSecondary,
                            },
                          ]}
                        />
                        <Text style={[styles.capText, { color: colors.muted }]} numberOfLines={1}>
                          {capDisplayLabel(cap.cap)}{' '}
                          {formatPercent(
                            entry.total > 0 ? (cap.value / entry.total) * 100 : 0,
                          )}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </View>

          {hidden > 0 ? (
            <Pressable
              onPress={() => setShowAll(true)}
              accessibilityRole="button"
              accessibilityLabel={`Show ${hidden} more sectors`}
              style={styles.showAll}
            >
              <Text style={[styles.showAllText, { color: colors.accent }]}>
                Show {hidden} more sectors
              </Text>
              <Feather name="chevron-down" size={14} color={colors.accent} />
            </Pressable>
          ) : sectors.length > 8 ? (
            <Pressable
              onPress={() => setShowAll(false)}
              accessibilityRole="button"
              accessibilityLabel="Show fewer sectors"
              style={styles.showAll}
            >
              <Text style={[styles.showAllText, { color: colors.accent }]}>Show less</Text>
              <Feather name="chevron-up" size={14} color={colors.accent} />
            </Pressable>
          ) : null}
        </>
      )}
    </AnalyticsCard>
  );
}

const styles = StyleSheet.create({
  empty: { ...type.body, paddingVertical: space.xl, textAlign: 'center' },
  capLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  legendDot: { width: 7, height: 7, borderRadius: 3.5 },
  legendText: { fontSize: 10 },
  list: { gap: space.md },
  row: { gap: space.xs },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  name: { flex: 1, fontSize: 12, fontWeight: '600' },
  value: { fontSize: 11, fontWeight: '500' },
  percent: { fontSize: 10, width: 48, textAlign: 'right' },
  track: {
    height: 7,
    borderRadius: 3.5,
    overflow: 'hidden',
    flexDirection: 'row',
    marginLeft: 16,
  },
  capLabels: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginLeft: 16,
  },
  capLabel: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: '48%' },
  capDot: { width: 4, height: 4, borderRadius: 2 },
  capText: { fontSize: 9 },
  showAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
  },
  showAllText: { fontSize: 12, fontWeight: '600' },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerLabel: { ...type.label },
  footerValue: { fontSize: 14, fontWeight: '600' },
});
