import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, SectionList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Search, Pencil, Trash2, ChevronDown, ChevronRight, ArrowUpDown } from 'lucide-react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { AddAssetSheet } from '@/components/AddAssetSheet';
import { useDashboard } from '@/hooks/useDashboardData';
import { useAssetForm } from '@/hooks/useAssetForm';
import { Asset } from '@/lib/types';
import { formatCompact, formatPercent } from '@/lib/format';
import { getConvertedPrice, guessCurrency, normalizeCategory, resolveCurrentPrice } from '@/lib/portfolio-utils';

const PRICE_DOT: Record<string, string> = {
  fetching: '#3B82F6', fresh: '#34D399', old: '#FBBF24', unknown: '#5A6B87',
};

export default function HoldingsScreen() {
  const dash = useDashboard();
  const { mergedAssets, prices, usdToInr, isSmallCrypto, assets } = dash;
  const form = useAssetForm(usdToInr);

  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sortKey, setSortKey] = useState<'currentValue' | 'pnlPercent' | 'name'>('currentValue');

  const { items, sections } = useMemo(() => {
    // Group by category + symbol (mirrors web renderAssets)
    const groups: Record<string, Asset[]> = {};
    mergedAssets.forEach((asset) => {
      const cat = normalizeCategory(asset.type);
      const key = `${cat}-${asset.symbol}`;
      (groups[key] = groups[key] || []).push(asset);
    });

    const aggregated: (Asset & { isGroup?: boolean; subItems?: Asset[] })[] = [];
    Object.values(groups).forEach((list) => {
      if (list.length > 1) {
        const first = list[0];
        const totalQty = list.reduce((s, i) => s + i.quantity, 0);
        let totalInvested = 0;
        list.forEach((i) => {
          totalInvested += getConvertedPrice(i.entryPrice, i.currency || guessCurrency(i.symbol), usdToInr) * i.quantity;
        });
        aggregated.push({
          ...first,
          id: `group-${first.symbol}`,
          quantity: totalQty,
          entryPrice: totalInvested / totalQty,
          currency: 'INR',
          isGroup: true,
          subItems: [...list].sort((a, b) => b.quantity - a.quantity),
        });
      } else {
        aggregated.push(list[0]);
      }
    });

    // Category ordering
    const catPriority = (a: Asset) => {
      const c = normalizeCategory(a.type);
      return { Equities: 1, 'Mutual Funds': 2, ETFs: 3, 'Fixed Income': 4, Commodities: 5, Crypto: 6, Cash: 7 }[c] ?? 8;
    };

    const valueOf = (a: Asset) => resolveCurrentPrice(a, prices, usdToInr).currentPrice * a.quantity;
    const investedOf = (a: Asset) =>
      (a.isGroup ? a.entryPrice : getConvertedPrice(a.entryPrice, a.currency || guessCurrency(a.symbol), usdToInr)) * a.quantity;

    const q = query.trim().toLowerCase();
    const filtered = q
      ? aggregated.filter((a) => (a.name || '').toLowerCase().includes(q) || (a.symbol || '').toLowerCase().includes(q))
      : aggregated;

    const sorted = [...filtered].sort((a, b) => {
      if (catPriority(a) !== catPriority(b)) return catPriority(a) - catPriority(b);
      if (catPriority(a) === 5 && isSmallCrypto(a) !== isSmallCrypto(b)) return isSmallCrypto(a) ? 1 : -1;
      if (sortKey === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sortKey === 'pnlPercent') {
        const iA = investedOf(a), iB = investedOf(b);
        const pA = iA > 0 ? (valueOf(a) - iA) / iA : 0;
        const pB = iB > 0 ? (valueOf(b) - iB) / iB : 0;
        return pB - pA;
      }
      return valueOf(b) - valueOf(a);
    });

    const secs: { title: string; data: typeof sorted }[] = [];
    sorted.forEach((a) => {
      const cat = normalizeCategory(a.type) || 'Other';
      const sec = secs.find((s) => s.title === cat);
      if (sec) sec.data.push(a);
      else secs.push({ title: cat, data: [a] });
    });
    return { items: sorted, sections: secs };
  }, [mergedAssets, prices, usdToInr, query, sortKey, isSmallCrypto]);

  const freshness = (asset: Asset): keyof typeof PRICE_DOT => {
    const pd = prices[asset.symbol];
    if (!pd) return asset.manualPrice != null ? 'fresh' : 'unknown';
    const age = Date.now() - (pd.lastUpdated || 0);
    if (age < 90_000) return 'fresh';
    if (age < 15 * 60_000) return 'old';
    return 'old';
  };

  const renderRow = ({ item, isSub }: { item: Asset & { subItems?: Asset[] }; isSub?: boolean }) => {
    const { currentPrice } = resolveCurrentPrice(item, prices, usdToInr);
    const currentValue = currentPrice * item.quantity;
    const invested = (item.isGroup ? item.entryPrice : getConvertedPrice(item.entryPrice, item.currency || guessCurrency(item.symbol), usdToInr)) * item.quantity;
    const pnl = currentValue - invested;
    const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
    const isProf = pnl >= 0;
    const hasSubs = !!item.isGroup && !!item.subItems?.length;
    const isOpen = expanded[item.id];

    return (
      <View className={isSub ? 'pl-8 bg-surfaceHigh/30' : ''}>
        <TouchableOpacity
          className="flex-row items-center px-4 py-3 border-b border-border/50"
          activeOpacity={hasSubs ? 0.7 : 1}
          onPress={hasSubs ? () => setExpanded((p) => ({ ...p, [item.id]: !p[item.id] })) : undefined}
        >
          <View className="w-2 h-2 rounded-full mr-2.5" style={{ backgroundColor: PRICE_DOT[freshness(item)] }} />
          <View className="flex-1 mr-2">
            <View className="flex-row items-center">
              {hasSubs ? (isOpen ? <ChevronDown size={14} color="#8FA3BF" /> : <ChevronRight size={14} color="#8FA3BF" />) : null}
              <Text className="text-textPrimary font-medium ml-1" numberOfLines={1}>{item.name}</Text>
            </View>
            <Text className="text-textMuted text-[11px] mt-0.5">
              {item.quantity} × {formatCompact(currentPrice)}{item.exchange ? ` · ${item.exchange}` : ''}
            </Text>
          </View>
          <View className="items-end mr-1">
            <Text className="text-textPrimary font-semibold text-sm">{formatCompact(currentValue)}</Text>
            <Text className={`text-[11px] font-semibold ${isProf ? 'text-profit' : 'text-loss'}`}>{formatPercent(pnlPct)}</Text>
          </View>
          {!hasSubs && (
            <View className="flex-row ml-1">
              <TouchableOpacity onPress={() => form.openForEdit(item)} className="p-1.5"><Pencil size={14} color="#8FA3BF" /></TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  Alert.alert('Delete Asset', `Remove ${item.name} (${item.symbol})?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => form.confirmDelete(item.id) },
                  ])
                }
                className="p-1.5"
              >
                <Trash2 size={14} color="#F87171" />
              </TouchableOpacity>
            </View>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScreenHeader title="Holdings" />

      {/* Search + sort bar */}
      <View className="px-4 pb-2 flex-row items-center gap-2">
        <View className="flex-1 flex-row items-center bg-surface border border-border rounded-xl px-3">
          <Search color="#5A6B87" size={15} />
          <TextInput
            className="flex-1 py-2 px-2 text-textPrimary text-sm"
            placeholder="Filter by name or symbol…"
            placeholderTextColor="#5A6B87"
            value={query}
            onChangeText={setQuery}
          />
        </View>
        <TouchableOpacity
          onPress={() => setSortKey((k) => (k === 'currentValue' ? 'pnlPercent' : k === 'pnlPercent' ? 'name' : 'currentValue'))}
          className="flex-row items-center bg-surface border border-border rounded-xl px-3 py-2.5"
        >
          <ArrowUpDown size={13} color="#8FA3BF" />
          <Text className="text-textSecondary text-xs ml-1">
            {sortKey === 'currentValue' ? 'Value' : sortKey === 'pnlPercent' ? 'P&L %' : 'Name'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Freshness legend */}
      <View className="flex-row gap-4 px-4 pb-2">
        {[['Fetching', 'fetching'], ['Live', 'fresh'], ['Stale', 'old'], ['N/A', 'unknown']].map(([label, k]) => (
          <View key={k} className="flex-row items-center">
            <View className="w-1.5 h-1.5 rounded-full mr-1" style={{ backgroundColor: PRICE_DOT[k] }} />
            <Text className="text-[10px] text-textMuted">{label}</Text>
          </View>
        ))}
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 120 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <Text className="px-4 pt-4 pb-1.5 text-xs font-bold uppercase tracking-widest text-textMuted">{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <View className="mx-4 mb-1 rounded-xl bg-surface border border-border overflow-hidden">
            {renderRow({ item })}
            {item.isGroup && expanded[item.id] && item.subItems?.map((sub) => (
              <View key={sub.id}>{renderRow({ item: sub, isSub: true })}</View>
            ))}
          </View>
        )}
        ListEmptyComponent={
          <View className="items-center pt-16">
            <Text className="text-textMuted text-sm">No assets yet. Tap + to add your first holding.</Text>
          </View>
        }
      />

      {/* FAB */}
      <TouchableOpacity
        onPress={form.openForAdd}
        className="absolute bottom-6 right-5 w-14 h-14 rounded-full bg-primary items-center justify-center shadow-lg active:opacity-80"
        style={{ elevation: 6 }}
      >
        <Plus color="#0B1220" size={28} strokeWidth={2.5} />
      </TouchableOpacity>

      <AddAssetSheet form={form} usdToInr={usdToInr} />
    </SafeAreaView>
  );
}
