import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner } from '@/src/components/ui/Banner';
import { Card } from '@/src/components/ui/Card';
import { IconButton } from '@/src/components/ui/IconButton';
import { Screen } from '@/src/components/ui/Screen';
import { ScreenHeader } from '@/src/components/ui/ScreenHeader';
import { SectionHeader } from '@/src/components/ui/SectionHeader';
import { EmptyState } from '@/src/components/ui/States';
import type { Holding } from '@/src/features/portfolio/aggregate';
import {
  cryptoBaseSymbol,
  cryptoDisplayName,
  cryptoSubtypeForAsset,
  hasKnownCostBasis,
} from '@/src/features/portfolio/crypto';
import { usePortfolioData } from '@/src/features/portfolio/queries';
import {
  formatINR,
  formatPercent,
  formatQuantity,
  formatSignedINR,
} from '@/src/lib/format/money';
import { numeric, radius, space, type } from '@/src/lib/theme/tokens';
import { useTheme } from '@/src/lib/theme/ThemeProvider';

function venueLabel(lot: Holding): string {
  return lot.asset.exchange ?? lot.asset.account ?? 'Manual lot';
}

function averageCostPaise(lot: Holding): number | null {
  if (!hasKnownCostBasis(lot.asset) || lot.asset.quantity <= 0) return null;
  return lot.investedValue / lot.asset.quantity;
}

export default function CryptoPositionScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ symbol?: string }>();
  const rawSymbol = Array.isArray(params.symbol) ? params.symbol[0] : params.symbol;
  const symbol = cryptoBaseSymbol(rawSymbol ?? '');
  const { summary, isLoading } = usePortfolioData();

  const position = summary.positions.find(
    (item) => item.positionKey === `crypto:${symbol}`,
  );

  if (!position) {
    return (
      <Screen>
        <ScreenHeader
          title="Crypto position"
          leading={
            <IconButton
              icon="arrow-left"
              onPress={() => router.back()}
              accessibilityLabel="Go back"
            />
          }
        />
        <Card>
          <EmptyState
            icon="alert-circle"
            title={isLoading ? 'Loading position' : 'Position not found'}
            message={
              isLoading
                ? 'Consolidating your crypto lots.'
                : 'This coin may have been removed or the portfolio changed on another device.'
            }
            actionLabel={isLoading ? undefined : 'Back to holdings'}
            onAction={isLoading ? undefined : () => router.back()}
          />
        </Card>
      </Screen>
    );
  }

  const lots = position.lots ?? [position];
  const knownLots = lots.filter((lot) => hasKnownCostBasis(lot.asset));
  const knownInvested = knownLots.reduce((sum, lot) => sum + lot.investedValue, 0);
  const knownCurrent = knownLots.reduce((sum, lot) => sum + lot.currentValue, 0);
  const knownPnl = knownCurrent - knownInvested;
  const knownPnlPercent =
    knownInvested > 0 ? (knownPnl / knownInvested) * 100 : null;
  const subtype = cryptoSubtypeForAsset(position.asset);
  const averageCost = position.averageCostPaise ?? null;
  const hasKnownBasis = knownLots.length > 0;
  const partial = position.costBasisIncomplete ?? false;
  const pnlTone =
    !hasKnownBasis
      ? colors.muted
      : knownPnl > 0
        ? colors.positive
        : knownPnl < 0
          ? colors.negative
          : colors.muted;

  return (
    <Screen>
      <View style={styles.navRow}>
        <IconButton
          icon="arrow-left"
          onPress={() => router.back()}
          accessibilityLabel="Go back"
        />
      </View>

      <ScreenHeader
        title={position.asset.name}
        subtitle={`${position.asset.symbol} · ${lots.length} ${
          lots.length === 1 ? 'lot' : 'lots'
        }`}
      />

      <View style={styles.stack}>
        {partial ? (
          <Banner
            tone="warning"
            icon="info"
            message="Some exchange balances have no cost basis. Average cost and P&L use only lots with a known basis."
          />
        ) : null}

        <Card style={styles.heroCard}>
          <View style={styles.heroTop}>
            <Text style={[type.label, { color: colors.muted }]}>
              Consolidated position
            </Text>
            {subtype ? (
              <View style={[styles.badge, { backgroundColor: `${colors.accent}18` }]}>
                <Text style={[styles.badgeText, { color: colors.accent }]}>
                  {subtype}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={[styles.heroValue, numeric, { color: colors.text }]}>
            {formatINR(position.currentValue)}
          </Text>
          <Text style={[type.caption, { color: colors.muted }]}>
            {formatQuantity(position.asset.quantity)}{' '}
            {cryptoDisplayName(symbol)} across {lots.length}{' '}
            {lots.length === 1 ? 'venue' : 'venues'}
          </Text>

          <View style={[styles.metrics, { borderTopColor: colors.border }]}>
            <View style={styles.metric}>
              <Text style={[styles.metricLabel, { color: colors.muted }]}>
                Average cost
              </Text>
              <Text style={[styles.metricValue, numeric, { color: colors.text }]}>
                {averageCost != null
                  ? formatINR(averageCost, { exact: true })
                  : '—'}
              </Text>
              <Text style={[styles.metricSub, { color: colors.muted }]}>
                {averageCost != null
                  ? `from ${knownLots.length} of ${lots.length} lots`
                  : 'not available'}
              </Text>
            </View>

            <View style={[styles.metricRule, { backgroundColor: colors.border }]} />

            <View style={styles.metric}>
              <Text style={[styles.metricLabel, { color: colors.muted }]}>
                P&L on known basis
              </Text>
              <Text style={[styles.metricValue, numeric, { color: pnlTone }]}>
                {hasKnownBasis ? formatSignedINR(knownPnl) : '—'}
              </Text>
              <Text style={[styles.metricSub, { color: pnlTone }]}>
                {knownPnlPercent != null
                  ? formatPercent(knownPnlPercent, { signed: true })
                  : 'no cost basis'}
              </Text>
            </View>
          </View>
        </Card>

        <View>
          <SectionHeader
            title="Lots"
            subtitle="Each venue balance stays a separate lot; nothing is merged away."
          />
          <View style={[styles.lotList, { borderColor: colors.border, backgroundColor: colors.card }]}>
            {lots.map((lot, index) => {
              const average = averageCostPaise(lot);
              const lotPnlTone = !hasKnownCostBasis(lot.asset)
                ? colors.muted
                : lot.pnl > 0
                  ? colors.positive
                  : lot.pnl < 0
                    ? colors.negative
                    : colors.muted;
              return (
                <Pressable
                  key={lot.asset.id}
                  onPress={() => router.push(`/asset/${lot.asset.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${venueLabel(lot)}, ${formatINR(
                    lot.currentValue,
                  )}`}
                  style={({ pressed }) => [
                    styles.lotRow,
                    index > 0
                      ? {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                        }
                      : null,
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <View style={styles.lotIdentity}>
                    <View
                      style={[
                        styles.lotIcon,
                        { backgroundColor: `${colors.accent}18` },
                      ]}
                    >
                      <Feather name="hexagon" size={14} color={colors.accent} />
                    </View>
                    <View style={styles.lotText}>
                      <Text
                        style={[type.bodyMedium, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {venueLabel(lot)}
                      </Text>
                      <Text
                        style={[type.caption, { color: colors.muted }]}
                        numberOfLines={1}
                      >
                        {formatQuantity(lot.asset.quantity)} {symbol}
                        {average != null
                          ? ` · avg ${formatINR(average, { exact: true })}`
                          : ' · no cost basis'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.lotNumbers}>
                    <Text
                      style={[styles.lotValue, numeric, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {formatINR(lot.currentValue)}
                    </Text>
                    <Text
                      style={[styles.lotPnl, numeric, { color: lotPnlTone }]}
                      numberOfLines={1}
                    >
                      {hasKnownCostBasis(lot.asset)
                        ? formatPercent(lot.pnlPercent, { signed: true })
                        : '—'}
                    </Text>
                  </View>

                  <Feather
                    name="chevron-right"
                    size={15}
                    color={colors.border}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={[type.caption, { color: colors.muted }]}>
          Exchange APIs expose balances, not purchase history. Add a manual lot
          for the same coin if you want its real cost included in the blended
          average.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  navRow: { flexDirection: 'row', justifyContent: 'flex-start' },
  stack: { gap: space.lg },
  heroCard: { gap: space.xs },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  badge: {
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  badgeText: { fontSize: 10, fontWeight: '700' },
  heroValue: { fontSize: 32, fontWeight: '700', letterSpacing: -0.6 },
  metrics: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: space.sm,
    paddingTop: space.md,
  },
  metric: { flex: 1, gap: 1 },
  metricRule: { width: StyleSheet.hairlineWidth, marginHorizontal: space.md },
  metricLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.4, textTransform: 'uppercase' },
  metricValue: { fontSize: 16, fontWeight: '600' },
  metricSub: { fontSize: 10 },
  lotList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  lotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
    paddingHorizontal: space.md,
  },
  lotIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  lotIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lotText: { flex: 1, minWidth: 0, gap: 1 },
  lotNumbers: { alignItems: 'flex-end', gap: 1 },
  lotValue: { fontSize: 13, fontWeight: '600' },
  lotPnl: { fontSize: 10, fontWeight: '600' },
  pressed: { opacity: 0.65 },
});
