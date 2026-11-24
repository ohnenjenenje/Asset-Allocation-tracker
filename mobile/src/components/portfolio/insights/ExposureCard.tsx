import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Donut } from '@/src/components/charts/Donut';
import { capDisplayLabel, type ExposureSlice } from '@/src/features/portfolio/analytics';
import { formatCompactINR, formatPercent } from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

import { AnalyticsCard } from './AnalyticsCard';

interface ExposureCardProps {
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof Feather>['name'];
  slices: ExposureSlice[];
  colors: Record<string, string>;
  centerLabel: string;
  emptyMessage: string;
  tint: string;
  tintSoft: string;
  directLabel?: string;
  indirectLabel?: string;
  initialLimit?: number;
}

/**
 * Donut + drill-down legend used by both market-cap and sector exposure. Each
 * row separates direct holdings from fund look-through, matching the web's
 * "Stocks vs Funds" split.
 */
export function ExposureCard({
  title,
  subtitle,
  icon,
  slices,
  colors,
  centerLabel,
  emptyMessage,
  tint,
  tintSoft,
  directLabel = 'Stocks',
  indirectLabel = 'Funds',
  initialLimit = 5,
}: ExposureCardProps) {
  const { colors: theme } = useTheme();
  const [showAll, setShowAll] = useState(false);
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [openConstituents, setOpenConstituents] = useState<Record<string, boolean>>({});

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const visible = showAll ? slices : slices.slice(0, initialLimit);
  const hidden = slices.length - visible.length;

  const toggleRow = (key: string) =>
    setOpenRows((current) => ({ ...current, [key]: !current[key] }));
  const toggleConstituent = (key: string) =>
    setOpenConstituents((current) => ({ ...current, [key]: !current[key] }));

  return (
    <AnalyticsCard icon={icon} title={title} subtitle={subtitle} tint={tint} tintSoft={tintSoft}>
      {slices.length === 0 || total <= 0 ? (
        <Text style={[styles.empty, { color: theme.muted }]}>{emptyMessage}</Text>
      ) : (
        <>
          <View style={styles.donutWrap}>
            <Donut
              data={slices.map((slice, index) => ({
                key: slice.key,
                value: slice.value,
                color: colors[slice.key] ?? fallbackColors[index % fallbackColors.length],
              }))}
              size={168}
              strokeWidth={20}
              accessibilityLabel={`${title} donut chart`}
            >
              <Text style={[type.label, { color: theme.muted }]}>{centerLabel}</Text>
              <Text style={[styles.donutValue, numeric, { color: theme.text }]}>
                {formatCompactINR(total)}
              </Text>
            </Donut>
          </View>

          <View style={styles.rows}>
            {visible.map((slice, index) => {
              const percent = total > 0 ? (slice.value / total) * 100 : 0;
              const directPercent = slice.value > 0 ? (slice.direct / slice.value) * 100 : 0;
              const indirectPercent = slice.value > 0 ? (slice.indirect / slice.value) * 100 : 0;
              const regionTotal = slice.regions
                ? slice.regions.domestic + slice.regions.global
                : 0;
              const regionParts: string[] = [];
              if (slice.regions && regionTotal > 0) {
                if (slice.regions.domestic > 0) {
                  regionParts.push(
                    `Domestic ${formatPercent((slice.regions.domestic / regionTotal) * 100)}`,
                  );
                }
                if (slice.regions.global > 0) {
                  regionParts.push(
                    `Global ${formatPercent((slice.regions.global / regionTotal) * 100)}`,
                  );
                }
              }
              const regionLabel = regionParts.join(' · ');
              const isOpen = Boolean(openRows[slice.key]);
              const hasDetail = slice.constituents.length > 0;
              const color =
                colors[slice.key] ?? fallbackColors[index % fallbackColors.length];

              return (
                <View
                  key={slice.key}
                  style={[styles.rowCard, { backgroundColor: theme.cardMuted }]}
                >
                  <Pressable
                    onPress={() => toggleRow(slice.key)}
                    disabled={!hasDetail}
                    accessibilityRole={hasDetail ? 'button' : undefined}
                    accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${capDisplayLabel(slice.name)}, ${formatPercent(percent)} of exposure${regionLabel ? `, ${regionLabel}` : ''}`}
                    style={styles.rowHeader}
                  >
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
                      {capDisplayLabel(slice.name)}
                    </Text>
                    <View style={styles.rowValueWrap}>
                      <Text style={[styles.rowValue, numeric, { color: theme.text }]}>
                        {formatCompactINR(slice.value)}
                      </Text>
                      <Text style={[styles.rowPercent, numeric, { color: theme.muted }]}>
                        {formatPercent(percent)}
                      </Text>
                    </View>
                    {hasDetail ? (
                      <Feather
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={theme.muted}
                      />
                    ) : null}
                  </Pressable>

                  {slice.direct > 0 || slice.indirect > 0 ? (
                    <>
                      <View style={[styles.splitTrack, { backgroundColor: theme.border }]}>
                        {slice.direct > 0 ? (
                          <View
                            style={{
                              flex: slice.direct,
                              backgroundColor: theme.accent,
                              height: '100%',
                            }}
                          />
                        ) : null}
                        {slice.indirect > 0 ? (
                          <View
                            style={{
                              flex: slice.indirect,
                              backgroundColor: theme.positive,
                              height: '100%',
                            }}
                          />
                        ) : null}
                      </View>
                      <View style={styles.splitLabels}>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: theme.accent }]} />
                          <Text style={[styles.splitText, { color: theme.muted }]}>
                            {directLabel} {formatPercent(directPercent, { signed: false })}
                          </Text>
                        </View>
                        <View style={styles.legendItem}>
                          <View style={[styles.legendDot, { backgroundColor: theme.positive }]} />
                          <Text style={[styles.splitText, { color: theme.muted }]}>
                            {indirectLabel} {formatPercent(indirectPercent, { signed: false })}
                          </Text>
                        </View>
                      </View>
                    </>
                  ) : null}

                  {regionLabel ? (
                    <Text style={[styles.regionText, { color: theme.muted }]}>
                      {regionLabel}
                    </Text>
                  ) : null}

                  {isOpen && hasDetail ? (
                    <View style={[styles.detail, { borderTopColor: theme.border }]}>
                      {(['direct', 'indirect'] as const).map((kind) => {
                        const group = slice.constituents
                          .filter((constituent) => constituent.type === kind)
                          .sort((a, b) => b.value - a.value);
                        if (group.length === 0) return null;
                        return (
                          <View key={kind} style={styles.detailGroup}>
                            <Text style={[styles.detailLabel, { color: theme.muted }]}>
                              {kind === 'direct' ? 'Direct holdings' : 'Fund / ETF look-through'}
                            </Text>
                            {group.map((constituent) => {
                              const constituentKey = `${slice.key}:${kind}:${constituent.symbol}`;
                              const constituentOpen = Boolean(openConstituents[constituentKey]);
                              const hasConstituentDetail =
                                (constituent.subHoldings?.length ?? 0) > 0 ||
                                (constituent.otherAllocations?.length ?? 0) > 0;
                              return (
                                <View key={constituentKey}>
                                  <Pressable
                                    onPress={() => toggleConstituent(constituentKey)}
                                    disabled={!hasConstituentDetail}
                                    accessibilityRole={hasConstituentDetail ? 'button' : undefined}
                                    accessibilityState={{ expanded: constituentOpen }}
                                    style={styles.constituentRow}
                                  >
                                    <Text
                                      style={[styles.constituentName, { color: theme.textSecondary }]}
                                      numberOfLines={1}
                                    >
                                      {constituent.name}
                                    </Text>
                                    {hasConstituentDetail ? (
                                      <Feather
                                        name={constituentOpen ? 'minus' : 'plus'}
                                        size={11}
                                        color={theme.muted}
                                      />
                                    ) : null}
                                    <Text style={[styles.constituentValue, numeric, { color: theme.textSecondary }]}>
                                      {formatCompactINR(constituent.value)}
                                    </Text>
                                  </Pressable>

                                  {constituentOpen ? (
                                    <View style={[styles.subList, { borderLeftColor: theme.border }]}>
                                      {(constituent.subHoldings ?? [])
                                        .slice()
                                        .sort((a, b) => b.value - a.value)
                                        .slice(0, 8)
                                        .map((holding) => (
                                          <View key={holding.name} style={styles.subRow}>
                                            <Text
                                              style={[styles.subName, { color: theme.muted }]}
                                              numberOfLines={1}
                                            >
                                              {holding.name}
                                            </Text>
                                            <Text style={[styles.subValue, numeric, { color: theme.muted }]}>
                                              {formatCompactINR(holding.value)}
                                            </Text>
                                          </View>
                                        ))}
                                      {(constituent.otherAllocations ?? [])
                                        .slice()
                                        .sort((a, b) => b.value - a.value)
                                        .map((allocation) => (
                                          <View key={allocation.name} style={styles.subRow}>
                                            <Text
                                              style={[styles.subName, { color: theme.muted }]}
                                              numberOfLines={1}
                                            >
                                              {allocation.name}
                                            </Text>
                                            <Text style={[styles.subValue, numeric, { color: theme.muted }]}>
                                              {formatCompactINR(allocation.value)}
                                            </Text>
                                          </View>
                                        ))}
                                    </View>
                                  ) : null}
                                </View>
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>

          {hidden > 0 ? (
            <Pressable
              onPress={() => setShowAll(true)}
              accessibilityRole="button"
              accessibilityLabel={`Show ${hidden} more categories`}
              style={styles.showAll}
            >
              <Text style={[styles.showAllText, { color: theme.accent }]}>
                Show {hidden} more
              </Text>
              <Feather name="chevron-down" size={14} color={theme.accent} />
            </Pressable>
          ) : slices.length > initialLimit ? (
            <Pressable
              onPress={() => setShowAll(false)}
              accessibilityRole="button"
              accessibilityLabel="Show fewer categories"
              style={styles.showAll}
            >
              <Text style={[styles.showAllText, { color: theme.accent }]}>Show less</Text>
              <Feather name="chevron-up" size={14} color={theme.accent} />
            </Pressable>
          ) : null}
        </>
      )}
    </AnalyticsCard>
  );
}

const fallbackColors = ['#2563EB', '#0D9488', '#7C3AED', '#D97706', '#DB2777', '#0EA5E9'];

const styles = StyleSheet.create({
  empty: { ...type.body, paddingVertical: space.xl, textAlign: 'center' },
  donutWrap: { alignItems: 'center' },
  donutValue: { fontSize: 18, fontWeight: '600', marginTop: 2 },
  rows: { gap: space.sm },
  rowCard: { borderRadius: radius.md, padding: space.md, gap: space.sm },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  rowName: { ...type.bodyMedium, flex: 1, fontWeight: '600' },
  rowValueWrap: { alignItems: 'flex-end' },
  rowValue: { fontSize: 13, fontWeight: '600' },
  rowPercent: { fontSize: 10 },
  splitTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
    marginLeft: 17,
  },
  splitLabels: { flexDirection: 'row', gap: space.lg, marginLeft: 17, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  legendDot: { width: 5, height: 5, borderRadius: 2.5 },
  splitText: { fontSize: 10 },
  regionText: { fontSize: 10, marginLeft: 17 },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm, gap: space.md },
  detailGroup: { gap: space.xs },
  detailLabel: { ...type.label, fontSize: 9, letterSpacing: 0.5 },
  constituentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 3,
  },
  constituentName: { flex: 1, fontSize: 12 },
  constituentValue: { fontSize: 11, fontWeight: '500' },
  subList: {
    borderLeftWidth: 1,
    marginLeft: 2,
    paddingLeft: space.sm,
    marginTop: 2,
    marginBottom: space.xs,
    gap: 2,
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  subName: { flex: 1, fontSize: 10 },
  subValue: { fontSize: 10 },
  showAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
  },
  showAllText: { fontSize: 12, fontWeight: '600' },
});
