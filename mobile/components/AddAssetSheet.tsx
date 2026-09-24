import React, { useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import BottomSheet, { BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { Search, X } from 'lucide-react-native';
import type { AssetForm } from '@/hooks/useAssetForm';
import { getConvertedPrice, guessCurrency } from '@/lib/portfolio-utils';

const SECTORS = [
  'Financial Services', 'Technology', 'Healthcare', 'Consumer Cyclical', 'Consumer Defensive',
  'Energy', 'Industrials', 'Real Estate', 'Communication Services', 'Basic Materials',
  'Utilities', 'Fixed Income / Debt', 'Cash / Liquid',
];

export function AddAssetSheet({ form, usdToInr }: { form: AssetForm; usdToInr: number }) {
  const sheetRef = useRef<BottomSheet>(null);

  useEffect(() => {
    if (form.isOpen) sheetRef.current?.expand();
    else sheetRef.current?.close();
  }, [form.isOpen]);

  const close = () => form.setIsOpen(false);
  const res = form.selectedResult;
  const existing = form.findExistingAssetToMerge(res);
  const isSpecial = res && ['GOLD-INR-GRAM', 'SILVER-INR-GRAM', 'CASH-INR'].includes(res.symbol);

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      snapPoints={['88%']}
      enablePanDownToClose
      onClose={close}
      backgroundStyle={{ backgroundColor: '#131C2E' }}
      handleIndicatorStyle={{ backgroundColor: '#5A6B87' }}
      backdropComponent={(p) => <BottomSheetBackdrop {...p} disappearsOnIndex={-1} appearsOnIndex={0} />}
    >
      <View className="flex-row justify-between items-center px-5 pb-3 border-b border-border">
        <Text className="text-lg font-semibold text-textPrimary">
          {form.editingAssetId ? 'Update Asset' : 'Add Asset'}
        </Text>
        <TouchableOpacity onPress={close} className="p-1"><X color="#8FA3BF" size={22} /></TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 18 }} keyboardShouldPersistTaps="handled">
          {/* Search */}
          <View>
            <Text className="text-sm font-medium text-textSecondary mb-1.5">Search Asset</Text>
            <View className="flex-row items-center bg-surface border border-border rounded-xl px-3">
              <Search color="#5A6B87" size={16} />
              <TextInput
                className="flex-1 py-2.5 px-2 text-textPrimary"
                placeholder="e.g. Reliance, TCS, BTC-USD, Gold"
                placeholderTextColor="#5A6B87"
                value={form.searchQuery}
                onChangeText={(t) => {
                  form.setSearchQuery(t);
                  if (form.selectedResult) form.setSelectedResult(null);
                }}
              />
              {form.searchQuery ? (
                <TouchableOpacity onPress={() => { form.setSearchQuery(''); form.setSearchResults([]); form.setSelectedResult(null); }}>
                  <X color="#5A6B87" size={16} />
                </TouchableOpacity>
              ) : null}
            </View>
            {form.isSearching && <Text className="text-textMuted text-xs mt-2">Searching…</Text>}
            {!form.selectedResult && form.searchResults.length > 0 && (
              <View className="mt-2 border border-border rounded-xl bg-surface overflow-hidden">
                {form.searchResults.slice(0, 20).map((r, i) => (
                  <TouchableOpacity
                    key={`${r.symbol}-${i}`}
                    className="px-4 py-3 border-b border-border/60"
                    onPress={() => { form.setSelectedResult(r); form.setSearchQuery(r.shortname || r.longname || r.symbol); form.setSearchResults([]); }}
                  >
                    <Text className="text-textPrimary font-medium" numberOfLines={1}>{r.shortname || r.longname}</Text>
                    <Text className="text-textMuted text-xs mt-0.5">
                      {(r.quoteType || r.typeDisp || '').toUpperCase()}  ·  {r.exchDisp || r.source}  ·  {r.symbol}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Selected */}
          {res && (
            <View className="p-4 bg-primary/10 border border-primary/30 rounded-xl">
              <View className="flex-row justify-between items-start">
                <View className="flex-1 mr-2">
                  <Text className="text-textPrimary font-semibold">{res.shortname || res.longname}</Text>
                  <Text className="text-primary/80 text-xs mt-0.5 uppercase tracking-wide">{res.symbol} · {res.quoteType || res.typeDisp}</Text>
                </View>
                <TouchableOpacity onPress={() => { form.setSelectedResult(null); form.setSearchQuery(''); form.setQuantity(''); form.setEntryPrice(''); }}>
                  <Text className="text-primary text-sm font-medium">Change</Text>
                </TouchableOpacity>
              </View>

              {existing && !form.editingAssetId && (
                <View className="mt-3 p-3 bg-amber/10 border border-amber/30 rounded-lg">
                  <Text className="text-amber text-xs font-medium">This asset is already in your portfolio — quantity & avg price will be merged.</Text>
                  {!!form.quantity && !!form.entryPrice && !isNaN(parseFloat(form.quantity)) && !isNaN(parseFloat(form.entryPrice)) && (
                    <TouchableOpacity onPress={form.handleMergeAsset} className="mt-2 bg-amber rounded-lg py-2 items-center active:opacity-80">
                      <Text className="text-[#0B1220] text-xs font-bold">Merge & Average</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}

          {/* Quantity / invested / price */}
          {res && (
            <View className="gap-y-4">
              <View>
                <Text className="text-sm font-medium text-textSecondary mb-1.5">Quantity</Text>
                <TextInput
                  keyboardType="decimal-pad"
                  className="bg-surface border border-border rounded-xl px-4 py-2.5 text-textPrimary"
                  placeholder="e.g. 10"
                  placeholderTextColor="#5A6B87"
                  value={form.quantity}
                  onChangeText={(t) => {
                    form.setQuantity(t);
                    if (isSpecial) {
                      const v = parseFloat(t); const p = parseFloat(form.entryPrice);
                      if (!isNaN(v) && !isNaN(p)) form.setInvestedValueInput((v * p).toFixed(2));
                    }
                  }}
                />
              </View>

              {isSpecial && (
                <View>
                  <Text className="text-sm font-medium text-textSecondary mb-1.5">Invested Value</Text>
                  <TextInput
                    keyboardType="decimal-pad"
                    className="bg-surface border border-border rounded-xl px-4 py-2.5 text-textPrimary"
                    placeholder="e.g. 1000"
                    placeholderTextColor="#5A6B87"
                    value={form.investedValueInput}
                    onChangeText={(t) => {
                      form.setInvestedValueInput(t);
                      const v = parseFloat(t); const q = parseFloat(form.quantity);
                      if (!isNaN(v) && !isNaN(q) && q > 0) form.setEntryPrice((v / q).toFixed(2));
                    }}
                  />
                </View>
              )}

              <View>
                <Text className="text-sm font-medium text-textSecondary mb-1.5">
                  {res.symbol === 'GOLD-INR-GRAM' ? 'Avg Buy Price' : 'Entry Price'}
                </Text>
                <View className="flex-row items-center bg-surface border border-border rounded-xl">
                  <TextInput
                    keyboardType="decimal-pad"
                    className="flex-1 px-4 py-2.5 text-textPrimary"
                    placeholder="e.g. 1500.50"
                    placeholderTextColor="#5A6B87"
                    value={form.entryPrice}
                    onChangeText={(t) => {
                      form.setEntryPrice(t);
                      if (isSpecial) {
                        const p = parseFloat(t); const q = parseFloat(form.quantity);
                        if (!isNaN(p) && !isNaN(q)) form.setInvestedValueInput((p * q).toFixed(2));
                      }
                    }}
                  />
                  <View className="flex-row mr-2 bg-surfaceHigh rounded-lg p-0.5">
                    {['INR', 'USD'].map((c) => (
                      <TouchableOpacity
                        key={c}
                        onPress={() => form.setEntryCurrency(c)}
                        className={`px-2.5 py-1 rounded-md ${form.entryCurrency === c ? 'bg-primary' : ''}`}
                      >
                        <Text className={`text-[11px] font-bold ${form.entryCurrency === c ? 'text-bg' : 'text-textMuted'}`}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <View>
                <Text className="text-sm font-medium text-textSecondary mb-1.5">Manual Price (LTP Override)</Text>
                <TextInput
                  keyboardType="decimal-pad"
                  className="bg-surface border border-border rounded-xl px-4 py-2.5 text-textPrimary"
                  placeholder="Leave empty to use market price"
                  placeholderTextColor="#5A6B87"
                  value={form.manualPrice}
                  onChangeText={form.setManualPrice}
                />
              </View>

              <View>
                <Text className="text-sm font-medium text-textSecondary mb-1.5">Purchase Date (YYYY-MM-DD, optional)</Text>
                <TextInput
                  className="bg-surface border border-border rounded-xl px-4 py-2.5 text-textPrimary"
                  placeholder="2024-06-30"
                  placeholderTextColor="#5A6B87"
                  autoCapitalize="none"
                  value={form.purchaseDate}
                  onChangeText={form.setPurchaseDate}
                />
                <Text className="text-[10px] text-textMuted mt-1">Used for LTCG/STCG tax estimation.</Text>
              </View>

              <View>
                <Text className="text-sm font-medium text-textSecondary mb-1.5">Sector (Manual Override)</Text>
                <TextInput
                  className="bg-surface border border-border rounded-xl px-4 py-2.5 text-textPrimary"
                  placeholder="e.g. Financial Services, Technology…"
                  placeholderTextColor="#5A6B87"
                  value={form.manualSector}
                  onChangeText={form.setManualSector}
                />
                <View className="flex-row flex-wrap gap-1.5 mt-2">
                  {SECTORS.map((s) => (
                    <TouchableOpacity key={s} onPress={() => form.setManualSector(s)} className="px-2 py-1 bg-surfaceHigh rounded-md border border-border">
                      <Text className="text-[10px] text-textSecondary">{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          )}

          {/* Actions */}
          <View className="flex-row justify-end gap-3 pt-2">
            <TouchableOpacity onPress={close} className="px-5 py-2.5 rounded-xl active:opacity-70">
              <Text className="text-textSecondary font-medium">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={form.handleAddAsset}
              disabled={!res || !form.quantity || !form.entryPrice}
              className={`px-5 py-2.5 rounded-xl ${!res || !form.quantity || !form.entryPrice ? 'bg-primary/30' : 'bg-primary'} active:opacity-80`}
            >
              <Text className="text-bg font-bold">{form.editingAssetId ? 'Update Asset' : 'Add Asset'}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}
