import React, { useRef, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import BottomSheet, { BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Target, ChevronDown, ChevronRight, Settings2, Trash2, Plus } from 'lucide-react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { useDashboard } from '@/hooks/useDashboardData';
import { formatInr } from '@/lib/format';
import { normalizeGroup } from '@/lib/portfolio-utils';

function AnalysisRow({ node, depth, expanded, toggle }: any) {
  const diff = node.diffPercentage;
  const isOpen = expanded[node.fullPath];
  const hasKids = node.subCategories?.length > 0;
  return (
    <View>
      <TouchableOpacity
        className={`flex-row items-center px-4 py-3 border-b border-border/50 ${depth > 0 ? 'bg-surfaceHigh/20' : ''}`}
        style={{ paddingLeft: 16 + depth * 16 }}
        onPress={hasKids ? () => toggle(node.fullPath) : undefined}
        activeOpacity={hasKids ? 0.7 : 1}
      >
        <View className="flex-1">
          <View className="flex-row items-center">
            {hasKids ? (isOpen ? <ChevronDown size={13} color="#8FA3BF" /> : <ChevronRight size={13} color="#8FA3BF" />) : null}
            <Text className={`${depth === 0 ? 'font-semibold' : ''} text-textPrimary text-sm ml-1`} numberOfLines={1}>
              {node.category}
            </Text>
          </View>
          <Text className="text-textMuted text-[11px] mt-0.5 ml-4">{formatInr(node.currentValue)}</Text>
        </View>
        <View className="items-end w-20">
          <Text className="text-textPrimary text-sm font-semibold">{node.currentPercentage.toFixed(1)}%</Text>
          <Text className="text-textMuted text-[10px]">ideal {node.idealPercentage.toFixed(1)}%</Text>
        </View>
        <View className="w-20 items-end">
          <Text className={`text-xs font-bold ${diff > 0.5 ? 'text-profit' : diff < -0.5 ? 'text-loss' : 'text-textMuted'}`}>
            {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
          </Text>
          <Text className={`text-[10px] ${diff > 0.5 ? 'text-loss' : diff < -0.5 ? 'text-primary' : 'text-textMuted'}`}>
            {diff > 0.5 ? `Reduce ${formatInr(Math.abs(node.diffValue))}` : diff < -0.5 ? `Buy ${formatInr(Math.abs(node.diffValue))}` : 'Balanced'}
          </Text>
        </View>
      </TouchableOpacity>
      {isOpen && node.subCategories.map((s: any) => (
        <AnalysisRow key={s.fullPath} node={s} depth={depth + 1} expanded={expanded} toggle={toggle} />
      ))}
    </View>
  );
}

export default function RebalanceScreen() {
  const { allocationAnalysis, consolidatedAllocation, idealAllocation, setIdealAllocation, syncToDb, totalAllocationValue } = useDashboard() as any;
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editMap, setEditMap] = useState<Record<string, string>>({});
  const [newKey, setNewKey] = useState('');
  const sheetRef = useRef<BottomSheet>(null);

  const toggle = (p: string) => setExpanded((e) => ({ ...e, [p]: !e[p] }));

  useEffect(() => {
    if (sheetOpen) {
      setEditMap(Object.fromEntries(Object.entries(idealAllocation).map(([k, v]: any) => [k, String(v)])));
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [sheetOpen]);

  const saveIdeal = () => {
    const next: Record<string, number> = {};
    Object.entries(editMap).forEach(([k, v]) => {
      const n = parseFloat(v);
      if (!isNaN(n)) next[k] = n;
    });
    if (newKey.trim()) {
      const n = parseFloat(editMap[newKey.trim()] || '0');
      next[newKey.trim()] = isNaN(n) ? 0 : n;
    }
    setIdealAllocation(next);
    syncToDb({ settings: { idealAllocation: next } });
    setSheetOpen(false);
    setNewKey('');
  };

  const totalIdeal = Object.values(editMap).reduce((s, v) => s + (parseFloat(v) || 0), 0);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScreenHeader title="Rebalance" />
      <FlatList
        data={allocationAnalysis}
        keyExtractor={(i: any) => i.fullPath}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <View className="mt-2 mb-3 flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Target color="#2DD4BF" size={18} />
              <Text className="text-textSecondary text-sm ml-2">Current vs ideal allocation</Text>
            </View>
            <TouchableOpacity onPress={() => setSheetOpen(true)} className="flex-row items-center bg-surface border border-border rounded-lg px-3 py-1.5">
              <Settings2 size={13} color="#2DD4BF" />
              <Text className="text-primary text-xs font-semibold ml-1.5">Edit Ideal</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-surface rounded-card border border-border mb-2 overflow-hidden">
            <AnalysisRow node={item} depth={0} expanded={expanded} toggle={toggle} />
          </View>
        )}
        ListEmptyComponent={
          <Card>
            <Text className="text-textMuted text-sm text-center py-6">
              Add assets and set an ideal allocation to see rebalancing guidance.
            </Text>
          </Card>
        }
      />

      {/* Ideal allocation editor */}
      <BottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={['70%']}
        enablePanDownToClose
        onClose={() => setSheetOpen(false)}
        backgroundStyle={{ backgroundColor: '#131C2E' }}
        handleIndicatorStyle={{ backgroundColor: '#5A6B87' }}
        backdropComponent={(p) => <BottomSheetBackdrop {...p} disappearsOnIndex={-1} appearsOnIndex={0} />}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View className="px-5 pb-3 border-b border-border flex-row justify-between items-center">
            <Text className="text-lg font-semibold text-textPrimary">Ideal Allocation</Text>
            <Text className={`text-sm font-bold ${Math.abs(totalIdeal - 100) < 0.01 ? 'text-profit' : 'text-amber'}`}>
              Total: {totalIdeal.toFixed(0)}%
            </Text>
          </View>
          <FlatList
            data={[...Object.entries(editMap)]}
            keyExtractor={([k]) => k}
            contentContainerStyle={{ padding: 20, gap: 12 }}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item: [key, val] }) => (
              <View className="flex-row items-center gap-3">
                <View className="flex-1">
                  <Text className="text-textPrimary text-sm font-medium">{key}</Text>
                  <Text className="text-textMuted text-[10px]">path: {normalizeGroup(key)}</Text>
                </View>
                <TextInput
                  keyboardType="decimal-pad"
                  value={val}
                  onChangeText={(t) => setEditMap((m) => ({ ...m, [key]: t }))}
                  className="w-20 bg-surfaceHigh border border-border rounded-lg px-3 py-2 text-textPrimary text-right"
                />
                <TouchableOpacity
                  onPress={() => setEditMap((m) => { const n = { ...m }; delete n[key]; return n; })}
                  className="p-1.5"
                >
                  <Trash2 size={15} color="#F87171" />
                </TouchableOpacity>
              </View>
            )}
          />
          <View className="flex-row items-center gap-2 px-5 pb-2">
            <TextInput
              value={newKey}
              onChangeText={setNewKey}
              placeholder="New category (e.g. Equities > Small Cap)"
              placeholderTextColor="#5A6B87"
              className="flex-1 bg-surfaceHigh border border-border rounded-lg px-3 py-2 text-textPrimary text-sm"
            />
            <TouchableOpacity
              onPress={() => {
                if (newKey.trim() && !(newKey.trim() in editMap)) setEditMap((m) => ({ ...m, [newKey.trim()]: '0' }));
              }}
              className="p-2 bg-surfaceHigh rounded-lg border border-border"
            >
              <Plus size={16} color="#2DD4BF" />
            </TouchableOpacity>
          </View>
          <View className="flex-row justify-end gap-3 px-5 pb-6 pt-1">
            <TouchableOpacity onPress={() => setSheetOpen(false)} className="px-4 py-2.5"><Text className="text-textSecondary font-medium">Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={saveIdeal} className="px-5 py-2.5 bg-primary rounded-xl active:opacity-80">
              <Text className="text-bg font-bold">Save</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </BottomSheet>
    </SafeAreaView>
  );
}
