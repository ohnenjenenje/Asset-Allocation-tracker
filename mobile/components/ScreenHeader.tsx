import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { RefreshCw, MessageCircle } from 'lucide-react-native';
import { router } from 'expo-router';
import { useDashboard } from '@/hooks/useDashboardData';
import * as Haptics from 'expo-haptics';

export function ScreenHeader({ title }: { title: string }) {
  const { fetchPrices, isLoadingPrices, priceProgress, binanceStatus, coindcxStatus } = useDashboard() as any;

  const refresh = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchPrices(true);
  };

  return (
    <View className="flex-row items-center justify-between px-4 pt-3 pb-2">
      <View className="flex-1">
        <Text className="text-xl font-bold text-textPrimary">{title}</Text>
        <View className="flex-row items-center gap-2 mt-1">
          {isLoadingPrices && priceProgress ? (
            <Text className="text-[11px] text-textMuted">Updating prices {priceProgress.done}/{priceProgress.total}…</Text>
          ) : null}
          {binanceStatus?.state === 'connected' || binanceStatus?.state === 'cached' ? (
            <View className={`px-1.5 py-0.5 rounded ${binanceStatus.state === 'connected' ? 'bg-profit/15' : 'bg-amber/15'}`}>
              <Text className={`text-[9px] font-bold uppercase ${binanceStatus.state === 'connected' ? 'text-profit' : 'text-amber'}`}>
                Binance {binanceStatus.state === 'connected' ? 'Live' : 'Cached'}
              </Text>
            </View>
          ) : null}
          {coindcxStatus?.state === 'connected' || coindcxStatus?.state === 'cached' ? (
            <View className={`px-1.5 py-0.5 rounded ${coindcxStatus.state === 'connected' ? 'bg-profit/15' : 'bg-amber/15'}`}>
              <Text className={`text-[9px] font-bold uppercase ${coindcxStatus.state === 'connected' ? 'text-profit' : 'text-amber'}`}>
                CoinDCX {coindcxStatus.state === 'connected' ? 'Live' : 'Cached'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <TouchableOpacity onPress={refresh} className="p-2.5 mr-1 active:opacity-60">
        <RefreshCw color={isLoadingPrices ? '#2DD4BF' : '#8FA3BF'} size={20} />
      </TouchableOpacity>
      <TouchableOpacity onPress={() => router.push('/chat')} className="p-2.5 active:opacity-60">
        <MessageCircle color="#8FA3BF" size={20} />
      </TouchableOpacity>
    </View>
  );
}
