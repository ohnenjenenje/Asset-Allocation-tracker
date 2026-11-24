import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';

import { Banner } from '@/src/components/ui/Banner';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { useAuth } from '@/src/features/auth/AuthProvider';
import { AssetForm } from '@/src/features/portfolio/AssetForm';
import { usePortfolioData, useSaveAssets } from '@/src/features/portfolio/queries';
import type { AssetFormOutput } from '@/src/features/portfolio/schema';
import type { Asset } from '@/src/features/portfolio/types';

export default function NewAssetScreen() {
  const router = useRouter();
  const { isDemo } = useAuth();
  const params = useLocalSearchParams<{ name?: string; symbol?: string; type?: string }>();
  const { savedAssets } = usePortfolioData();
  const saveMutation = useSaveAssets();
  const [serverError, setServerError] = useState<string | null>(null);

  const prefilled =
    params.name || params.symbol
      ? { name: params.name, symbol: params.symbol, type: params.type }
      : undefined;

  const handleSubmit = async (values: AssetFormOutput) => {
    if (isDemo) return;
    setServerError(null);
    const asset: Asset = {
      id: `asset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: values.name,
      symbol: values.symbol,
      type: values.type,
      quantity: values.quantity,
      entryPrice: values.entryPrice,
      manualPrice: typeof values.manualPrice === 'number' ? values.manualPrice : undefined,
      manualSector: values.manualSector?.trim() || undefined,
      manualCap: values.manualCap || undefined,
      manualLiquidity: values.manualLiquidity || undefined,
      cryptoSubtype:
        values.type === 'CRYPTO' ? values.cryptoSubtype || undefined : undefined,
      account: values.account?.trim() || undefined,
      currency: values.currency,
    };

    try {
      await saveMutation.mutateAsync([asset, ...savedAssets]);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not save the asset.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ScreenHeader
          title="Add asset"
          subtitle="Live quotes are fetched automatically by symbol"
          action={<IconButton icon="x" onPress={() => router.back()} accessibilityLabel="Close" />}
        />

        {isDemo ? (
          <Banner
            tone="warning"
            icon="eye"
            message="Demo mode is read-only. Sign in with your account to add holdings."
          />
        ) : null}

        <AssetForm
          initial={prefilled}
          submitLabel="Add to portfolio"
          submitting={saveMutation.isPending}
          disabled={isDemo}
          serverError={serverError}
          onSubmit={handleSubmit}
        />
      </Screen>
    </KeyboardAvoidingView>
  );
}
