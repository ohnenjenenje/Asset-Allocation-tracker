import { Feather } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '@/src/components/ui/Card';
import { radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface SignalCardProps {
  icon: ComponentProps<typeof Feather>['name'];
  tint: string;
  tintSoft: string;
  title: string;
  subtitle: string;
  badge?: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Shared compact shell for the three Signals cards. The whole surface is the
 * tap target; detail screens carry refresh controls and the full dataset.
 */
export function SignalCard({
  icon,
  tint,
  tintSoft,
  title,
  subtitle,
  badge,
  onPress,
  accessibilityLabel,
  children,
  footer,
}: SignalCardProps) {
  const { colors } = useTheme();

  return (
    <Card onPress={onPress} accessibilityLabel={accessibilityLabel} style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: tintSoft }]}>
          <Feather name={icon} size={16} color={tint} />
        </View>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text style={[type.title, styles.title, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            {badge}
          </View>
          <Text style={[type.caption, { color: colors.muted }]} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
      </View>

      {children}

      {footer ? (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <View style={styles.footerText}>{footer}</View>
          <Feather name="chevron-right" size={16} color={colors.muted} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2, paddingTop: 1 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  title: { flex: 1 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.sm,
  },
  footerText: { flex: 1 },
});
