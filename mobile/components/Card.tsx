import React, { ReactNode } from 'react';
import { View, Text } from 'react-native';

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <View className={`bg-surface rounded-card border border-border overflow-hidden ${className}`}>
      {(title || action) && (
        <View className="px-4 py-4 border-b border-border flex-row justify-between items-center">
          {title ? <Text className="text-base font-semibold text-textPrimary">{title}</Text> : <View />}
          {action}
        </View>
      )}
      <View className="p-4">{children}</View>
    </View>
  );
}
