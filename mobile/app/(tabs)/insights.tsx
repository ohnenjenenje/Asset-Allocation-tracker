import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { AllocationDonut, DonutLegend } from '@/components/AllocationDonut';
import { useDashboard } from '@/hooks/useDashboardData';
import { formatCompact, formatInr } from '@/lib/format';
import { COLORS } from '@/lib/constants';

function BarRow({ name, value, pct, color, sub }: { name: string; value: number; pct: number; color: string; sub?: string }) {
  return (
    <View className="mb-3">
      <View className="flex-row justify-between mb-1">
        <View className="flex-1 mr-2">
          <Text className="text-textSecondary text-sm" numberOfLines={1}>{name}</Text>
          {sub ? <Text className="text-textMuted text-[10px]">{sub}</Text> : null}
        </View>
        <Text className="text-textPrimary text-sm font-semibold">{formatCompact(value)} · {pct.toFixed(1)}%</Text>
      </View>
      <View className="h-2 bg-surfaceHigh rounded-full overflow-hidden">
        <View className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }} />
      </View>
    </View>
  );
}

export default function InsightsScreen() {
  const {
    marketCapAllocation, sectorAllocation, fundAllocation,
    stackedBarData, totalAllocationValue, topUnderlying, totalCurrentValue,
  } = useDashboard() as any;

  const capData = marketCapAllocation && Object.entries(marketCapAllocation).filter(([, v]: any) => v.total > 0);
  const sectorData = sectorAllocation && Object.entries(sectorAllocation).filter(([, v]: any) => (v as any).value > 0);
  const sectorTotal = sectorData?.reduce((s: number, [, v]: any) => s + (v as any).value, 0) || 0;
  const fundData = fundAllocation && Object.entries(fundAllocation).filter(([, v]: any) => (v as any).value > 0);
  const fundTotal = fundData?.reduce((s: number, [, v]: any) => s + (v as any).value, 0) || 0;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScreenHeader title="Insights" />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>

        <Card title="Market Cap Exposure" className="mb-4">
          {capData?.length ? (
            capData.map(([name, d]: any, i: number) => {
              const pct = totalCurrentValue > 0 ? (d.total / totalCurrentValue) * 100 : 0;
              return (
                <BarRow
                  key={name}
                  name={name}
                  value={d.total}
                  pct={pct}
                  color={COLORS[i % COLORS.length]}
                  sub={`Direct ${formatCompact(d.direct)} · via funds ${formatCompact(d.indirect)}`}
                />
              );
            })
          ) : (
            <Text className="text-textMuted text-sm">No equity exposure yet.</Text>
          )}
        </Card>

        <Card title="Sector Allocation" className="mb-4">
          {sectorData?.length ? (
            <>
              <View className="items-center mb-4">
                <AllocationDonut data={sectorData.map(([name, v]: any) => ({ name, value: (v as any).value }))} size={190} />
              </View>
              <DonutLegend data={sectorData.map(([name, v]: any) => ({ name, value: (v as any).value }))} total={sectorTotal} />
            </>
          ) : (
            <Text className="text-textMuted text-sm">No sector data yet.</Text>
          )}
        </Card>

        <Card title="Mutual Fund / ETF Allocation" className="mb-4">
          {fundData?.length ? (
            <>
              <View className="items-center mb-4">
                <AllocationDonut data={fundData.map(([name, v]: any) => ({ name, value: (v as any).value }))} size={190} />
              </View>
              <DonutLegend data={fundData.map(([name, v]: any) => ({ name, value: (v as any).value }))} total={fundTotal} />
            </>
          ) : (
            <Text className="text-textMuted text-sm">No fund allocation data yet.</Text>
          )}
        </Card>

        <Card title="Sector Distribution across Market Caps" className="mb-4">
          {stackedBarData?.length ? (
            stackedBarData.map((row: any) => {
              const entries = Object.entries(row).filter(([k]) => k !== 'name') as [string, number][];
              const total = entries.reduce((s, [, v]) => s + v, 0);
              const pctOfAll = totalAllocationValue > 0 ? (total / totalAllocationValue) * 100 : 0;
              return (
                <View key={row.name} className="mb-4">
                  <View className="flex-row justify-between mb-1.5">
                    <Text className="text-textSecondary text-sm font-medium">{row.name}</Text>
                    <Text className="text-textMuted text-xs">{formatCompact(total)} · {pctOfAll.toFixed(1)}%</Text>
                  </View>
                  <View className="h-3 rounded-full overflow-hidden flex-row bg-surfaceHigh">
                    {entries.filter(([, v]) => v > 0).map(([k, v], i) => (
                      <View key={k} style={{ flex: v / (total || 1), backgroundColor: COLORS[i % COLORS.length] }} />
                    ))}
                  </View>
                  <View className="flex-row flex-wrap gap-x-3 gap-y-1 mt-1.5">
                    {entries.filter(([, v]) => v > 0).map(([k, v], i) => (
                      <View key={k} className="flex-row items-center">
                        <View className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <Text className="text-textMuted text-[10px]">
                          {k.replace('Value', '')} {total > 0 ? ((v / total) * 100).toFixed(0) : 0}%
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })
          ) : (
            <Text className="text-textMuted text-sm">No data yet.</Text>
          )}
        </Card>

        <Card title="Top Underlying Exposure">
          {topUnderlying?.length ? (
            topUnderlying.map((u: any, i: number) => (
              <View key={u.symbol || i} className="flex-row items-center justify-between py-2.5 border-b border-border/50">
                <View className="flex-row items-center flex-1 mr-3">
                  <View className="w-7 h-7 rounded-lg bg-surfaceHigh items-center justify-center mr-2.5">
                    <Text className="text-textMuted text-xs font-bold">{i + 1}</Text>
                  </View>
                  <View className="flex-1">
                    <Text className="text-textPrimary text-sm font-medium" numberOfLines={1}>{u.name}</Text>
                    <Text className="text-textMuted text-[10px]">{u.symbol}{u.marketCapCategory ? ` · ${u.marketCapCategory}` : ''}</Text>
                  </View>
                </View>
                <Text className="text-textPrimary text-sm font-semibold">{formatInr(u.value)}</Text>
              </View>
            ))
          ) : (
            <Text className="text-textMuted text-sm">No holdings data yet.</Text>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
