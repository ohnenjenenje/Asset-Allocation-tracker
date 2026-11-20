import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';

import { Banner } from '@/src/components/ui/Banner';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { EmptyState } from '@/src/components/ui/States';
import { useAuth } from '@/src/features/auth/AuthProvider';
import { AssetForm } from '@/src/features/portfolio/AssetForm';
import { usePortfolioData, useSaveAssets } from '@/src/features/portfolio/queries';
import type { AssetFormOutput } from '@/src/features/portfolio/schema';

export default function EditAssetScreen() {
  const router = useRouter();
  const { isDemo } = useAuth();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { savedAssets, isLoading } = usePortfolioData();
  const saveMutation = useSaveAssets();
  const [serverError, setServerError] = useState<string | null>(null);

  const asset = savedAssets.find((item) => item.id === id);

  const handleSubmit = async (values: AssetFormOutput) => {
    if (!asset || isDemo) return;
    setServerError(null);

    const updated = savedAssets.map((item) =>
      item.id === asset.id
        ? {
            ...item,
            name: values.name,
            symbol: values.symbol,
            type: values.type,
            quantity: values.quantity,
            entryPrice: values.entryPrice,
            manualPrice:
              typeof values.manualPrice === 'number' ? values.manualPrice : undefined,
            manualSector: values.manualSector?.trim() || undefined,
            manualCap: values.manualCap || undefined,
            manualLiquidity: values.manualLiquidity || undefined,
            account: values.account?.trim() || undefined,
            currency: values.currency,
          }
        : item,
    );

    try {
      await saveMutation.mutateAsync(updated);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      router.back();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : 'Could not update the asset.');
    }
  };

  if (!asset && !isLoading) {
    return (
      <Screen>
        <ScreenHeader
          title="Edit asset"
          action={<IconButton icon="x" onPress={() => router.back()} accessibilityLabel="Close" />}
        />
        <Card>
          <EmptyState
            icon="alert-circle"
            title="Asset not found"
            message="It may have been removed or the portfolio changed on another device."
            actionLabel="Go back"
            onAction={() => router.back()}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <ScreenHeader
          title="Edit asset"
          subtitle={asset?.symbol}
          action={<IconButton icon="x" onPress={() => router.back()} accessibilityLabel="Close" />}
        />

        {isDemo ? (
          <Banner
            tone="warning"
            icon="eye"
            message="Demo mode is read-only. Sign in with your account to edit holdings."
          />
        ) : null}

        {asset ? (
          <AssetForm
            initial={asset}
            submitLabel="Save changes"
            submitting={saveMutation.isPending}
            disabled={isDemo}
            serverError={serverError}
            onSubmit={handleSubmit}
          />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
