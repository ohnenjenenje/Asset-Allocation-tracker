import { useRouter } from 'expo-router';

import { SectorPeExplorer } from '@/src/components/market/SectorPeExplorer';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';

/** Full sector universe: all 45 indices, filters, search and expandable rows. */
export default function SectorsDetailScreen() {
  const router = useRouter();

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Research signal"
        title="Sector valuations"
        subtitle="43 sector and thematic indices, with broad benchmarks kept separate"
        leading={
          <IconButton
            icon="arrow-left"
            variant="plain"
            size={36}
            onPress={() => router.back()}
            accessibilityLabel="Back to Research"
          />
        }
      />
      <SectorPeExplorer />
    </Screen>
  );
}
