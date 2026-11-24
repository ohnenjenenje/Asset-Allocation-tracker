import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { capDisplayLabel, type CapSectorRow } from '@/src/features/portfolio/analytics';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { AnalyticsCard } from './AnalyticsCard';

interface SectorCapTreemapProps {
  rows: CapSectorRow[];
  sectorColors: Record<string, string>;
  capColors: Record<string, string>;
}

/**
 * Mobile-native treemap: one band per market-cap segment, subdivided into
 * sector tiles sized by value. Tap a band for exact weights.
 */
export function SectorCapTreemap({ rows, sectorColors, capColors }: SectorCapTreemapProps) {
  const { colors } = useTheme();
  const [openCaps, setOpenCaps] = useState<Record<string, boolean>>({});

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const maxCap = Math.max(...rows.map((row) => row.total), 1);

  return (
    <AnalyticsCard
      icon="grid"
      title="Sector by Market Cap"
      subtitle="Combined exposure · tap a band for detail"
      tint="#EA580C"
      tintSoft="rgba(234, 88, 12, 0.12)"
      footer={
        <View style={styles.footerRow}>
          <Text style={[styles.footerLabel, { color: colors.muted }]}>Combined equity</Text>
          <Text style={[styles.footerValue, numeric, { color: colors.text }]}>
            {formatCompactINR(total)}
          </Text>
        </View>
      }
    >
      {rows.length === 0 || total <= 0 ? (
        <Text style={[styles.empty, { color: colors.muted }]}>
          Add equities or funds with look-through data to see the combined map.
        </Text>
      ) : (
        <View style={styles.bands}>
          {rows.map((row) => {
            const share = total > 0 ? (row.total / total) * 100 : 0;
            const height = 46 + Math.round((row.total / maxCap) * 36);
            const isOpen = Boolean(openCaps[row.cap]);
            const capColor =
              capColors[row.cap] ?? colors.textSecondary;
            const label = capDisplayLabel(row.cap);
            const regionTotal = row.regions.domestic + row.regions.global;
            const regionParts: string[] = [];
            if (regionTotal > 0) {
              if (row.regions.domestic > 0) {
                regionParts.push(
                  `Domestic ${formatPercent((row.regions.domestic / regionTotal) * 100)}`,
                );
              }
              if (row.regions.global > 0) {
                regionParts.push(
                  `Global ${formatPercent((row.regions.global / regionTotal) * 100)}`,
                );
              }
            }
            const regionLabel = regionParts.join(' · ');

            return (
              <View key={row.cap} style={styles.band}>
                <Pressable
                  onPress={() =>
                    setOpenCaps((current) => ({ ...current, [row.cap]: !current[row.cap] }))
                  }
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${label}, ${formatPercent(share)} of equity exposure${regionLabel ? `, ${regionLabel}` : ''}`}
                  style={styles.bandHeader}
                >
                  <View style={[styles.dot, { backgroundColor: capColor }]} />
                  <Text style={[styles.bandName, { color: colors.text }]}>{label}</Text>
                  <Text style={[styles.bandValue, numeric, { color: colors.textSecondary }]}>
                    {formatCompactINR(row.total)}
                  </Text>
                  <Text style={[styles.bandPercent, numeric, { color: colors.muted }]}>
                    {formatPercent(share)}
                  </Text>
                  <Feather
                    name={isOpen ? 'chevron-up' : 'chevron-down'}
                    size={13}
                    color={colors.muted}
                  />
                </Pressable>

                {regionLabel ? (
                  <Text style={[styles.regionText, { color: colors.muted }]}>{regionLabel}</Text>
                ) : null}

                <View style={[styles.tiles, { height }]}>
                  {row.sectors.map((sector) => {
                    const sectorValue = sector.value;
                    const sectorShare = row.total > 0 ? (sectorValue / row.total) * 100 : 0;
                    const showLabel = sectorShare >= 9;
                    return (
                      <View
                        key={sector.sector}
                        style={[
                          styles.tile,
                          {
                            flex: sectorValue,
                            backgroundColor:
                              sectorColors[sector.sector] ?? colors.textSecondary,
                          },
                        ]}
                        accessible
                        accessibilityLabel={`${sector.sector}, ${formatCompactINR(
                          sectorValue,
                        )} in ${label}`}
                      >
                        {showLabel ? (
                          <>
                            <Text style={styles.tileName} numberOfLines={1}>
                              {sector.sector}
                            </Text>
                            <Text style={[styles.tileValue, numeric]} numberOfLines={1}>
                              {formatPercent(sectorShare)}
                            </Text>
                          </>
                        ) : null}
                      </View>
                    );
                  })}
                </View>

                {isOpen ? (
                  <View style={[styles.detail, { borderTopColor: colors.border }]}>
                    {row.sectors.map((sector) => (
                      <View key={sector.sector} style={styles.detailRow}>
                        <View
                          style={[
                            styles.detailDot,
                            { backgroundColor: sectorColors[sector.sector] ?? colors.muted },
                          ]}
                        />
                        <Text
                          style={[styles.detailName, { color: colors.textSecondary }]}
                          numberOfLines={1}
                        >
                          {sector.sector}
                        </Text>
                        <Text style={[styles.detailPercent, numeric, { color: colors.muted }]}>
                          {formatPercent(
                            row.total > 0 ? (sector.value / row.total) * 100 : 0,
                          )}
                        </Text>
                        <Text style={[styles.detailValue, numeric, { color: colors.text }]}>
                          {formatCompactINR(sector.value)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </AnalyticsCard>
  );
}

const styles = StyleSheet.create({
  empty: { ...type.body, paddingVertical: space.xl, textAlign: 'center' },
  bands: { gap: space.md },
  band: { gap: space.xs },
  bandHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  bandName: { flex: 1, fontSize: 12, fontWeight: '600' },
  bandValue: { fontSize: 11, fontWeight: '500' },
  bandPercent: { fontSize: 10, width: 48, textAlign: 'right' },
  regionText: { fontSize: 10, marginLeft: 16 },
  tiles: { flexDirection: 'row', gap: 2, overflow: 'hidden', borderRadius: radius.sm },
  tile: {
    minWidth: 0,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 5,
    justifyContent: 'flex-end',
  },
  tileName: { color: '#FFFFFF', fontSize: 9, fontWeight: '600' },
  tileValue: { color: 'rgba(255,255,255,0.82)', fontSize: 8, marginTop: 1 },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: 3 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  detailDot: { width: 6, height: 6, borderRadius: 3 },
  detailName: { flex: 1, fontSize: 11 },
  detailPercent: { width: 46, fontSize: 10, textAlign: 'right' },
  detailValue: { width: 68, fontSize: 10, textAlign: 'right' },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  footerLabel: { ...type.label },
  footerValue: { fontSize: 14, fontWeight: '600' },
});
