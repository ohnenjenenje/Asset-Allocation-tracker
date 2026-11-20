import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { GoldSilverFeedComparison } from '@/src/components/market/GoldSilverFeedComparison';
import { GoldSilverRatioCard } from '@/src/components/market/GoldSilverRatioCard';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { useGoldSilverRatio } from '@/src/features/market/goldSilver';
import { space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

const BANDS = [
  { range: 'At or below 50', label: 'Gold relatively cheap', tone: 'warning' as const },
  { range: '50 – 80', label: 'Balanced / no edge', tone: 'neutral' as const },
  { range: 'At or above 80', label: 'Silver relatively cheap', tone: 'accent' as const },
];

/** Full gold/silver signal: primary quote, both feeds and the band methodology. */
export default function GoldSilverDetailScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { data } = useGoldSilverRatio();

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Research signal"
        title="Gold / silver"
        subtitle="Relative value between the two metals, with both feeds compared"
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

      <View style={styles.stack}>
        <GoldSilverRatioCard />
        {data ? <GoldSilverFeedComparison data={data} /> : null}

        <Card style={styles.card}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: colors.cardMuted }]}>
              <Feather name="book-open" size={16} color={colors.textSecondary} />
            </View>
            <View style={styles.headerText}>
              <Text style={[type.title, { color: colors.text }]}>How the signal is built</Text>
              <Text style={[type.caption, { color: colors.muted }]}>
                A relative-value heuristic, not a forecast
              </Text>
            </View>
          </View>

          {BANDS.map((band) => (
            <View key={band.range} style={styles.band}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor:
                      band.tone === 'warning'
                        ? colors.warning
                        : band.tone === 'accent'
                          ? colors.accent
                          : colors.muted,
                  },
                ]}
              />
              <Text style={[styles.bandRange, { color: colors.text }]}>{band.range}</Text>
              <Text style={[styles.bandLabel, { color: colors.muted }]}>{band.label}</Text>
            </View>
          ))}

          <Text style={[styles.note, { color: colors.muted }]}>
            The ratio is ounces of silver per ounce of gold. High readings make silver cheap
            relative to gold; low readings make gold cheap relative to silver. Extremes can persist
            for years, so the band is context for a staged entry, not a promise of reversion.
          </Text>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  card: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  band: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 7, height: 7, borderRadius: 4 },
  bandRange: { width: 92, fontSize: 11, fontWeight: '600' },
  bandLabel: { flex: 1, fontSize: 11 },
  note: { ...type.caption, fontSize: 10.5, lineHeight: 15 },
});
