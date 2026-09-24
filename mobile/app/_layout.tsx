import 'react-native-get-random-values';
import 'react-native-gesture-handler';
import 'react-native-reanimated';
import '@/global.css';

import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { PortfolioProvider } from '@/hooks/usePortfolioData';
import { DashboardProvider } from '@/hooks/useDashboardData';
import { router } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';

function RootNavigator() {
  const { user, isAuthReady } = useAuth();
  const [navigated, setNavigated] = useState(false);

  useEffect(() => {
    if (!isAuthReady) return;
    if (!user) {
      router.replace('/login');
    } else {
      router.replace('/(tabs)/overview');
    }
    setNavigated(true);
  }, [user, isAuthReady]);

  if (!isAuthReady || !navigated) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <ActivityIndicator size="large" color="#2DD4BF" />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0B1220' } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <AuthProvider>
            <PortfolioProvider>
              <DashboardProvider>
                <StatusBar style="light" />
                <RootNavigator />
              </DashboardProvider>
            </PortfolioProvider>
          </AuthProvider>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
