import type { ReactNode } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { layout, space } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

interface ScreenProps {
  children: ReactNode;
  /** Wrap content in a ScrollView (disable for virtualized lists). */
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export function Screen({
  children,
  scroll = true,
  refreshing = false,
  onRefresh,
  contentContainerStyle,
  style,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  // The safe-area padding lives on a wrapper, not the ScrollView itself.
  // Otherwise the scroll viewport stays full-bleed and content slides under the
  // status bar clock and icons while scrolling. Left/right insets matter on
  // tablets and landscape phones with cutouts.
  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.bg,
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
        style,
      ]}
    >
      {scroll ? (
        <ScrollView
          style={styles.root}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: space.sm,
              paddingBottom: insets.bottom + space.xxxl * 2,
            },
            contentContainerStyle,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.muted}
                colors={[colors.accent]}
              />
            ) : undefined
          }
        >
          <View style={styles.centered}>{children}</View>
        </ScrollView>
      ) : (
        <View style={[styles.centered, styles.fill]}>{children}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: {
    paddingHorizontal: space.lg,
  },
  centered: {
    width: '100%',
    maxWidth: layout.contentMaxWidth,
    alignSelf: 'center',
  },
  fill: { flex: 1 },
});
