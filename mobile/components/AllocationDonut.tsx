import React from 'react';
import { View, Text } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import { COLORS } from '@/lib/constants';

type Slice = { name: string; value: number };

/** Lightweight donut chart built directly on react-native-svg (no web-only deps). */
export function AllocationDonut({
  data,
  size = 200,
  strokeWidth = 28,
  centerLabel,
  centerValue,
  topLevelOnly = true,
}: {
  data: Slice[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerValue?: string;
  topLevelOnly?: boolean;
}) {
  const slices = topLevelOnly
    ? data.filter((d) => !d.name.includes('>'))
    : data;
  const total = slices.reduce((s, d) => s + d.value, 0);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let angleAcc = -90; // start at top
  const arcs = total > 0
    ? slices
        .filter((d) => d.value > 0)
        .map((d, i) => {
          const fraction = d.value / total;
          const angle = fraction * 360;
          const dash = (angle / 360) * circumference;
          const gap = Math.min(2, dash * 0.04);
          const rotation = angleAcc;
          angleAcc += angle;
          return {
            rotation,
            dash: Math.max(dash - gap, 0),
            color: COLORS[i % COLORS.length],
            name: d.name,
            value: d.value,
            fraction,
          };
        })
    : [];

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation="0">
          {arcs.map((arc, i) => (
            <Circle
              key={i}
              cx={center}
              cy={center}
              r={radius}
              stroke={arc.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arc.dash} ${circumference}`}
              rotation={arc.rotation}
              origin={`${center}, ${center}`}
              fill="none"
              strokeLinecap="butt"
            />
          ))}
        </G>
      </Svg>
      {(centerLabel || centerValue) && (
        <View style={{ position: 'absolute', alignItems: 'center' }}>
          {centerLabel ? <Text className="text-textMuted text-xs">{centerLabel}</Text> : null}
          {centerValue ? <Text className="text-textPrimary font-bold text-lg">{centerValue}</Text> : null}
        </View>
      )}
    </View>
  );
}

export function DonutLegend({ data, total }: { data: Slice[]; total?: number }) {
  const slices = data.filter((d) => !d.name.includes('>') || d.value > 0).filter((d) => d.value > 0);
  const t = total ?? slices.reduce((s, d) => s + d.value, 0);
  return (
    <View className="gap-y-2">
      {slices.map((d, i) => (
        <View key={d.name} className="flex-row items-center justify-between">
          <View className="flex-row items-center flex-1 mr-2">
            <View
              className="w-2.5 h-2.5 rounded-full mr-2"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
            <Text className="text-textSecondary text-sm" numberOfLines={1}>
              {d.name.split('>').pop()?.trim()}
            </Text>
          </View>
          <Text className="text-textPrimary text-sm font-semibold">
            {t > 0 ? ((d.value / t) * 100).toFixed(1) : '0.0'}%
          </Text>
        </View>
      ))}
    </View>
  );
}
