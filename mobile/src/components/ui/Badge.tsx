import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

export type BadgeTone = 'neutral' | 'positive' | 'negative' | 'accent' | 'warning';

interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
}

export function Badge({ label, tone = 'neutral', style }: BadgeProps) {
  const { colors } = useTheme();

  const tones: Record<BadgeTone, { fg: string; bg: string }> = {
    neutral: { fg: colors.muted, bg: colors.cardMuted },
    positive: { fg: colors.positive, bg: colors.positiveSoft },
    negative: { fg: colors.negative, bg: colors.negativeSoft },
    accent: { fg: colors.accent, bg: colors.accentSoft },
    warning: { fg: colors.warning, bg: colors.warningSoft },
  };
  const palette = tones[tone];

  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }, style]}>
      <Text style={[styles.label, numeric, { color: palette.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  label: {
    fontSize: 11,
    fontWeight: type.label.fontWeight,
    letterSpacing: 0.2,
  },
});
