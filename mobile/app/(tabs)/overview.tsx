import React, { useMemo } from 'react';
import { ScrollView, View, Text, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { TrendingUp, TrendingDown, PieChart as PieChartIcon, Wallet } from 'lucide-react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { StatCard } from '@/components/StatCard';
import { AllocationDonut, DonutLegend } from '@/components/AllocationDonut';
import { useDashboard } from '@/hooks/useDashboardData';
import { formatInr, formatSignedInr, formatPercent, formatCompact } from '@/lib/format';

export default function OverviewScreen() {
  const {
    portfolioStats, totalProfitLoss, totalProfitLossPercent,
    allocationData, totalCurrentValue, mergedAssets,
    fetchPrices, isLoadingPrices,
  } = useDashboard();

  const groupedAllocationData = useMemo(() => {
    const groups: Record<string, { name: string; value: number }> = {};
    allocationData.forEach((item: any) => {
      const parentName = item.name.includes(' > ') ? item.name.split(' > ')[0].trim() : item.name.trim();
      if (!groups[parentName]) groups[parentName] = { name: parentName, value: 0 };
      groups[parentName].value += item.value;
    });
    return Object.values(groups).sort((a, b) => b.value - a.value);
  }, [allocationData]);

  const isProfit = totalProfitLoss >= 0;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScreenHeader title="Overview" />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={isLoadingPrices} onRefresh={() => fetchPrices(true)} tintColor="#2DD4BF" />
        }
      >
        {/* Hero value card */}
        <LinearGradient
          colors={['#123B3A', '#0B1220']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 16, padding: 20, borderWidth: 1, borderColor: '#24334F', marginBottom: 16 }}
        >
          <Text className="text-xs uppercase tracking-widest text-textMuted mb-1">Total Portfolio Value</Text>
          <Text className="text-4xl font-extrabold text-textPrimary tracking-tight">
            {formatInr(portfolioStats.currentValue, 2)}
          </Text>
          <View className="flex-row items-center mt-2">
            {isProfit ? <TrendingUp color="#4ADE80" size={16} /> : <TrendingDown color="#F87171" size={16} />}
            <Text className={`ml-1.5 font-bold ${isProfit ? 'text-profit' : 'text-loss'}`}>
              {formatSignedInr(totalProfitLoss)} ({formatPercent(totalProfitLossPercent)})
            </Text>
          </View>
        </LinearGradient>

        {/* Stat row */}
        <View className="flex-row gap-3 mb-6">
          <StatCard label="Invested" value={formatCompact(portfolioStats.investedValue)} />
          <StatCard
            label="P&L"
            value={formatCompact(totalProfitLoss)}
            subValue={formatPercent(totalProfitLossPercent)}
            valueColor={isProfit ? 'text-profit' : 'text-loss'}
          />
          <StatCard label="Assets" value={String(mergedAssets.length)} />
        </View>

        {/* Allocation donut */}
        <Card
          title="Asset Allocation"
          action={<PieChartIcon color="#2DD4BF" size={18} />}
          className="mb-6"
        >
          {groupedAllocationData.length === 0 ? (
            <View className="items-center py-8">
              <Wallet color="#5A6B87" size={32} />
              <Text className="text-textMuted mt-3 text-sm">No holdings yet. Add an asset from the Holdings tab.</Text>
            </View>
          ) : (
            <>
              <View className="items-center mb-5">
                <AllocationDonut
                  data={groupedAllocationData}
                  size={220}
                  strokeWidth={30}
                  centerLabel="Total"
                  centerValue={formatCompact(totalCurrentValue)}
                />
              </View>
              <DonutLegend data={groupedAllocationData} />
            </>
          )}
        </Card>

        {/* Category breakdown */}
        <Card title="By Asset Class">
          <View className="gap-y-3">
            {groupedAllocationData.map((g: any) => {
              const pct = totalCurrentValue > 0 ? (g.value / totalCurrentValue) * 100 : 0;
              return (
                <View key={g.name}>
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-textSecondary text-sm">{g.name}</Text>
                    <Text className="text-textPrimary text-sm font-semibold">{formatInr(g.value)}</Text>
                  </View>
                  <View className="h-1.5 bg-surfaceHigh rounded-full overflow-hidden">
                    <View className="h-full bg-primary rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </View>
                </View>
              );
            })}
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
