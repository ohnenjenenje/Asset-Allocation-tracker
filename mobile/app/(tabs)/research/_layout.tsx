import { Stack } from 'expo-router';

import { useTheme } from '@/src/lib/theme/ThemeProvider';

export const unstable_settings = {
  anchor: 'index',
};

/** Nested stack inside the Research tab; the tab bar stays visible. */
export default function ResearchLayout() {
  const { colors } = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="gold-silver" />
      <Stack.Screen name="india-pe" />
      <Stack.Screen name="sectors" />
    </Stack>
  );
}
