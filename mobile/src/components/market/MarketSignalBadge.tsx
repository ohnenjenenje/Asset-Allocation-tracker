import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { MarketEntryTone } from '@/src/features/market/entrySignal';
import { radius, space } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface MarketSignalBadgeProps {
  label: string;
  tone: MarketEntryTone;
  icon: ComponentProps<typeof Feather>['name'];
}

/**
 * Compact, colour-coded entry signal used at the top of the market cards so the
 * buy/neutral/expensive state is visible before reading the supporting detail.
 */
export function MarketSignalBadge({ label, tone, icon }: MarketSignalBadgeProps) {
  const { colors } = useTheme();
  const palette: Record<MarketEntryTone, { fg: string; bg: string }> = {
    positive: { fg: colors.positive, bg: colors.positiveSoft },
    warning: { fg: colors.warning, bg: colors.warningSoft },
    accent: { fg: colors.accent, bg: colors.accentSoft },
    neutral: { fg: colors.muted, bg: colors.cardMuted },
  };
  const tonePalette = palette[tone];

  return (
    <View style={[styles.badge, { backgroundColor: tonePalette.bg }]}>
      <Feather name={icon} size={11} color={tonePalette.fg} />
      <Text style={[styles.label, { color: tonePalette.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    borderRadius: radius.full,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
  },
  label: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
