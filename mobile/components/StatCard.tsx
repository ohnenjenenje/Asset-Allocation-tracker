import React from 'react';
import { View, Text } from 'react-native';

export function StatCard({
  label,
  value,
  subValue,
  valueColor = 'text-textPrimary',
}: {
  label: string;
  value: string;
  subValue?: string;
  valueColor?: string;
}) {
  return (
    <View className="bg-surface rounded-card border border-border p-4 flex-1">
      <Text className="font-medium text-xs uppercase tracking-wider text-textMuted mb-1">{label}</Text>
      <Text className={`text-lg font-bold ${valueColor}`} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {subValue ? <Text className={`text-xs font-semibold mt-0.5 ${valueColor}`}>{subValue}</Text> : null}
    </View>
  );
}
