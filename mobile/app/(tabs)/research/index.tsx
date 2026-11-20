import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GoldSilverSignalCard } from '@/src/components/market/GoldSilverSignalCard';
import { IndiaPeSignalCard } from '@/src/components/market/IndiaPeSignalCard';
import { SectorPeSignalCard } from '@/src/components/market/SectorPeSignalCard';
import { Card } from '@/src/components/ui/Card';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { SegmentedControl } from '@/src/components/ui/SegmentedControl';
import { useGoldSilverRatio } from '@/src/features/market/goldSilver';
import { useIndiaPe } from '@/src/features/market/indiaPe';
import { formatRelativeTime } from '@/src/lib/format/time';
import { radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

type ResearchSegment = 'signals' | 'tools';

interface ToolCardProps {
  icon: ComponentProps<typeof Feather>['name'];
  title: string;
  description: string;
  meta: string;
  tint: string;
  tintSoft: string;
  onPress: () => void;
  accessibilityLabel: string;
}

function ToolCard({
  icon,
  title,
  description,
  meta,
  tint,
  tintSoft,
  onPress,
  accessibilityLabel,
}: ToolCardProps) {
  const { colors } = useTheme();

  return (
    <Card onPress={onPress} accessibilityLabel={accessibilityLabel} style={styles.toolCard}>
      <View style={[styles.toolIcon, { backgroundColor: tintSoft }]}>
        <Feather name={icon} size={19} color={tint} />
      </View>
      <View style={styles.toolText}>
        <Text style={[type.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.toolDescription, { color: colors.muted }]}>{description}</Text>
        <Text style={[styles.toolMeta, { color: colors.muted }]}>{meta}</Text>
      </View>
      <Feather name="arrow-up-right" size={18} color={colors.muted} />
    </Card>
  );
}

/**
 * Research is split into entry signals and the read-only tools that support a
 * decision. Each signal card opens a full detail screen inside this tab.
 */
export default function ResearchScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [segment, setSegment] = useState<ResearchSegment>('signals');
  const goldSilver = useGoldSilverRatio();
  const indiaPe = useIndiaPe();

  const lastUpdated = Math.max(goldSilver.dataUpdatedAt, indiaPe.dataUpdatedAt);
  const updatedLabel = lastUpdated > 0 ? formatRelativeTime(lastUpdated) : '';
  const refreshing = goldSilver.isFetching || indiaPe.isFetching;

  const refreshSignals = () => {
    void goldSilver.refetch();
    void indiaPe.refetch();
  };

  return (
    <Screen
      onRefresh={segment === 'signals' ? refreshSignals : undefined}
      refreshing={segment === 'signals' && refreshing}
    >
      <ScreenHeader
        eyebrow="Beyond the portfolio"
        title="Research"
        subtitle="Relative-value signals for entry decisions, plus the tools that support them"
      />

      <View style={styles.segment}>
        <SegmentedControl
          options={[
            { value: 'signals', label: 'Signals' },
            { value: 'tools', label: 'Tools' },
          ]}
          value={segment}
          onChange={setSegment}
          accessibilityLabel="Research section"
        />
        {segment === 'signals' && updatedLabel ? (
          <Text style={[styles.updated, { color: colors.muted }]}>
            Updated {updatedLabel} · pull to refresh
          </Text>
        ) : null}
      </View>

      {segment === 'signals' ? (
        <View style={styles.stack}>
          <View>
            <SectionHeader
              title="Entry signals"
              subtitle="Gold, silver and Indian indices measured against their own history"
            />
            <View style={styles.cards}>
              <GoldSilverSignalCard />
              <IndiaPeSignalCard />
              <SectorPeSignalCard />
            </View>
          </View>

          <View style={[styles.caveat, { backgroundColor: colors.cardMuted }]}>
            <Feather name="info" size={14} color={colors.muted} />
            <Text style={[styles.caveatText, { color: colors.muted }]}>
              Buy zone means valuation supports fresh buying, not an automatic entry. Percentiles
              compare each index with its own five-year history. A reading exactly at the 25th or
              75th percentile is labelled “at cutoff” because it is the weakest point of its zone.
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.stack}>
          <View>
            <SectionHeader
              title="Research tools"
              subtitle="Everything that supports a decision without changing your allocation"
            />
            <View style={styles.cards}>
              <ToolCard
                icon="filter"
                title="Stock screener"
                description="Filter Indian equities by size, valuation and dividend yield, then add a candidate straight to your holdings."
                meta="Market data via Tickertape"
                tint={colors.accent}
                tintSoft={colors.accentSoft}
                onPress={() => router.push('/screener')}
                accessibilityLabel="Open the stock screener"
              />

              <ToolCard
                icon="message-circle"
                title="AI assistant"
                description="Ask about your holdings, allocation drift or any stock. The assistant can read your portfolio and explain it."
                meta="Portfolio-aware · read-only"
                tint={colors.positive}
                tintSoft={colors.positiveSoft}
                onPress={() => router.push('/assistant')}
                accessibilityLabel="Open the AI assistant"
              />

              <ToolCard
                icon="bar-chart-2"
                title="Portfolio insights"
                description="See market-cap exposure, sector look-through, fund overlap and concentration risk behind your sleeves."
                meta="Look-through analytics"
                tint={colors.warning}
                tintSoft={colors.warningSoft}
                onPress={() => router.push('/insights')}
                accessibilityLabel="Open portfolio insights"
              />
            </View>
          </View>

          <Text style={[styles.note, { color: colors.muted }]}>
            Research tools are read-only. Adding a holding from the screener updates the
            portfolio, so your allocation and drift recalculate immediately.
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  segment: { gap: space.sm, marginBottom: space.xl },
  updated: { fontSize: 10.5, textAlign: 'center' },
  stack: { gap: space.xl },
  cards: { gap: space.md },
  caveat: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.md,
  },
  caveatText: { flex: 1, fontSize: 10.5, lineHeight: 15 },
  toolCard: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  toolIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolText: { flex: 1, gap: 3, paddingTop: 1 },
  toolDescription: { ...type.caption, lineHeight: 18 },
  toolMeta: {
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.35,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  note: {
    ...type.caption,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: space.lg,
  },
});
