import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GoldSilverRatioCard } from '@/src/components/market/GoldSilverRatioCard';
import { IndiaIndexPeCard } from '@/src/components/market/IndiaIndexPeCard';
import { Card } from '@/src/components/ui/Card';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

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
 * Research holds the tools that are not part of the allocation loop. The
 * screener and assistant used to occupy primary tabs; they remain fully
 * available here without competing with allocation, holdings and insights.
 */
export default function ResearchScreen() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <Screen>
      <ScreenHeader
        eyebrow="Beyond the portfolio"
        title="Research"
        subtitle="Screen new ideas, inspect exposure and ask questions"
      />

      <View style={styles.stack}>
        <View>
          <SectionHeader
            title="Market indicator"
            subtitle="Valuation and relative-value signals for Indian indices, gold and silver"
          />
          <View style={styles.marketCards}>
            <GoldSilverRatioCard />
            <IndiaIndexPeCard />
          </View>
        </View>

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.xl },
  marketCards: { gap: space.md },
  cards: { gap: space.md },
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
