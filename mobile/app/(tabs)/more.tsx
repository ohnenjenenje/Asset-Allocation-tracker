import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import {
  ChevronRight, Download, Upload, RefreshCcw, LogOut,
  Search, Check, RefreshCw,
} from 'lucide-react-native';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Card } from '@/components/Card';
import { useDashboard } from '@/hooks/useDashboardData';
import { useAuth } from '@/hooks/useAuth';

function Row({ icon, label, sub, onPress, danger }: any) {
  return (
    <TouchableOpacity onPress={onPress} className="flex-row items-center py-3.5 border-b border-border/50 active:opacity-70">
      {icon}
      <View className="flex-1 ml-3">
        <Text className={`${danger ? 'text-loss' : 'text-textPrimary'} text-sm font-medium`}>{label}</Text>
        {sub ? <Text className="text-textMuted text-[11px] mt-0.5">{sub}</Text> : null}
      </View>
      <ChevronRight size={16} color="#5A6B87" />
    </TouchableOpacity>
  );
}

function ExchangeCard({ exchange, status, hasKeys, onSave, onClear, onSync }: any) {
  const [apiKey, setApiKey] = useState('');
  const [secret, setSecret] = useState('');
  const [editing, setEditing] = useState(false);
  return (
    <View className="mb-4 bg-surfaceHigh rounded-xl border border-border p-4">
      <View className="flex-row items-center justify-between mb-1">
        <Text className="text-textPrimary font-semibold">{exchange}</Text>
        <View className={`px-2 py-0.5 rounded ${status.state === 'connected' ? 'bg-profit/15' : status.state === 'cached' ? 'bg-amber/15' : status.state === 'error' ? 'bg-loss/15' : 'bg-surface'}`}>
          <Text className={`text-[10px] font-bold uppercase ${status.state === 'connected' ? 'text-profit' : status.state === 'cached' ? 'text-amber' : status.state === 'error' ? 'text-loss' : 'text-textMuted'}`}>
            {status.state}
          </Text>
        </View>
      </View>
      {status.state === 'error' && <Text className="text-loss text-xs mb-2">{status.error}</Text>}
      {status.lastSynced ? <Text className="text-textMuted text-[10px] mb-2">Last synced {new Date(status.lastSynced).toLocaleString()}</Text> : null}

      {editing || !hasKeys ? (
        <>
          <TextInput className="bg-surface border border-border rounded-lg px-3 py-2 text-textPrimary text-sm mb-2" placeholder="API Key" placeholderTextColor="#5A6B87" autoCapitalize="none" value={apiKey} onChangeText={setApiKey} />
          <TextInput className="bg-surface border border-border rounded-lg px-3 py-2 text-textPrimary text-sm mb-3" placeholder="API Secret" placeholderTextColor="#5A6B87" autoCapitalize="none" secureTextEntry value={secret} onChangeText={setSecret} />
          <View className="flex-row gap-2">
            <TouchableOpacity onPress={async () => { if (!apiKey || !secret) return; await onSave(apiKey, secret); setEditing(false); setApiKey(''); setSecret(''); }} className="flex-1 bg-primary rounded-lg py-2 items-center">
              <Text className="text-bg font-bold text-sm">Save & Sync</Text>
            </TouchableOpacity>
            {hasKeys ? (
              <TouchableOpacity onPress={() => setEditing(false)} className="px-4 py-2"><Text className="text-textSecondary text-sm">Cancel</Text></TouchableOpacity>
            ) : null}
          </View>
          <Text className="text-textMuted text-[10px] mt-2">Keys are stored only on this device (SecureStore). Data is fetched directly from the exchange — bypasses server geo-blocks.</Text>
        </>
      ) : (
        <View className="flex-row gap-2 mt-1">
          <TouchableOpacity onPress={onSync} className="flex-1 bg-surface border border-border rounded-lg py-2 items-center flex-row justify-center">
            <RefreshCw size={13} color="#2DD4BF" /><Text className="text-primary text-sm font-semibold ml-1.5">Re-sync</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setEditing(true)} className="flex-1 bg-surface border border-border rounded-lg py-2 items-center"><Text className="text-textSecondary text-sm font-semibold">Change keys</Text></TouchableOpacity>
          <TouchableOpacity onPress={onClear} className="px-3 py-2 bg-loss/10 rounded-lg items-center justify-center"><Text className="text-loss text-sm font-semibold">Clear</Text></TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export default function MoreScreen() {
  const { signOut, user } = useAuth();
  const dash = useDashboard() as any;
  const {
    assets, fundHoldings, idealAllocation, searchSource, setSearchSource,
    aiProvider, setAiProvider, selectedModel, setSelectedModel, googleModel, setGoogleModel,
    availableModels, openRouterKey, saveOpenRouterKey, syncToDb,
    handleRestoreFromMongo, restoreStatus, forceRefreshHoldings,
    binanceStatus, coindcxStatus, hasBinanceKeys, hasCoindcxKeys,
    saveKeys, clearKeys, syncBinance, syncCoindcx,
  } = dash;

  const [keyInput, setKeyInput] = useState(openRouterKey || '');
  const [modelsOpen, setModelsOpen] = useState(false);

  const exportData = async () => {
    try {
      const dataToExport = {
        assets, fundHoldings,
        settings: { idealAllocation, searchSource, aiProvider, openrouterModel: selectedModel, googleModel },
      };
      const path = `${FileSystem.cacheDirectory}portfolio-backup-${new Date().toISOString().split('T')[0]}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(dataToExport, null, 2));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'application/json' });
      else Alert.alert('Exported', path);
    } catch (e: any) {
      Alert.alert('Export failed', e?.message || String(e));
    }
  };

  const importData = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'application/json', copyToCacheDirectory: true });
      if (res.canceled) return;
      const content = await FileSystem.readAsStringAsync(res.assets[0].uri);
      const data = JSON.parse(content);
      if (data.assets) { dash.setAssets(data.assets); }
      if (data.fundHoldings) { dash.setFundHoldings(data.fundHoldings); }
      if (data.settings) {
        if (data.settings.idealAllocation) { dash.setIdealAllocation(data.settings.idealAllocation); syncToDb({ settings: { idealAllocation: data.settings.idealAllocation } }); }
        if (data.settings.searchSource) { setSearchSource(data.settings.searchSource); syncToDb({ settings: { searchSource: data.settings.searchSource } }); }
        if (data.settings.aiProvider) { setAiProvider(data.settings.aiProvider); syncToDb({ settings: { aiProvider: data.settings.aiProvider } }); }
        if (data.settings.openrouterModel) { setSelectedModel(data.settings.openrouterModel); syncToDb({ settings: { openrouterModel: data.settings.openrouterModel } }); }
        if (data.settings.googleModel) { setGoogleModel(data.settings.googleModel); syncToDb({ settings: { googleModel: data.settings.googleModel } }); }
      }
      syncToDb({ assets: data.assets, fundHoldings: data.fundHoldings });
      Alert.alert('Success', 'Data imported successfully.');
    } catch (e: any) {
      Alert.alert('Import failed', 'Please ensure the file is a valid backup JSON.');
    }
  };

  const SOURCES = ['tickertape', 'yahoo', 'indianapi', 'newapi'];
  const GOOGLE_MODELS = ['gemini-3.1-flash-lite-preview', 'gemini-3.1-pro-preview', 'gemini-flash-latest'];

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top']}>
      <ScreenHeader title="More" />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        <Card title="Crypto Exchange Sync" className="mb-4">
          <ExchangeCard exchange="Binance" status={binanceStatus} hasKeys={hasBinanceKeys} onSave={(k: string, s: string) => saveKeys('binance', k, s)} onClear={() => clearKeys('binance')} onSync={syncBinance} />
          <ExchangeCard exchange="CoinDCX" status={coindcxStatus} hasKeys={hasCoindcxKeys} onSave={(k: string, s: string) => saveKeys('coindcx', k, s)} onClear={() => clearKeys('coindcx')} onSync={syncCoindcx} />
        </Card>

        <Card title="AI Assistant" className="mb-4">
          <Text className="text-textMuted text-[11px] mb-2 uppercase tracking-wider font-semibold">Provider</Text>
          <View className="flex-row gap-2 mb-4">
            {(['google', 'openrouter'] as const).map((p) => (
              <TouchableOpacity key={p} onPress={() => { setAiProvider(p); syncToDb({ settings: { aiProvider: p } }); }} className={`flex-1 py-2.5 rounded-xl border items-center ${aiProvider === p ? 'bg-primary/15 border-primary' : 'bg-surfaceHigh border-border'}`}>
                <Text className={`font-semibold text-sm ${aiProvider === p ? 'text-primary' : 'text-textSecondary'}`}>{p === 'google' ? 'Gemini' : 'OpenRouter'}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {aiProvider === 'google' ? (
            <>
              <Text className="text-textMuted text-[11px] mb-2 uppercase tracking-wider font-semibold">Model</Text>
              {GOOGLE_MODELS.map((m) => (
                <TouchableOpacity key={m} onPress={() => { setGoogleModel(m); syncToDb({ settings: { googleModel: m } }); }} className="flex-row items-center py-2">
                  <View className={`w-4 h-4 rounded-full border-2 mr-2 items-center justify-center ${googleModel === m ? 'border-primary' : 'border-border'}`}>
                    {googleModel === m && <View className="w-2 h-2 rounded-full bg-primary" />}
                  </View>
                  <Text className="text-textSecondary text-sm">{m}</Text>
                </TouchableOpacity>
              ))}
            </>
          ) : (
            <>
              <Text className="text-textMuted text-[11px] mb-2 uppercase tracking-wider font-semibold">OpenRouter API Key</Text>
              <View className="flex-row gap-2 mb-3">
                <TextInput
                  className="flex-1 bg-surfaceHigh border border-border rounded-lg px-3 py-2 text-textPrimary text-sm"
                  placeholder="sk-or-..."
                  placeholderTextColor="#5A6B87"
                  secureTextEntry
                  autoCapitalize="none"
                  value={keyInput}
                  onChangeText={setKeyInput}
                />
                <TouchableOpacity onPress={() => { saveOpenRouterKey(keyInput); Alert.alert('Saved', 'OpenRouter key saved.'); }} className="bg-primary rounded-lg px-4 justify-center">
                  <Text className="text-bg font-bold text-sm">Save</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity onPress={() => setModelsOpen(!modelsOpen)} className="flex-row items-center justify-between bg-surfaceHigh border border-border rounded-lg px-3 py-2.5 mb-1">
                <Text className="text-textSecondary text-sm flex-1 mr-2" numberOfLines={1}>{selectedModel}</Text>
                <Search size={14} color="#8FA3BF" />
              </TouchableOpacity>
              {modelsOpen ? (
                <View className="max-h-48 border border-border rounded-lg mt-1 overflow-hidden">
                  <ScrollView nestedScrollEnabled>
                    {availableModels.map((m: any) => (
                      <TouchableOpacity key={m.id} onPress={() => { setSelectedModel(m.id); syncToDb({ settings: { openrouterModel: m.id } }); setModelsOpen(false); }} className="px-3 py-2 border-b border-border/50 flex-row items-center">
                        {selectedModel === m.id ? <Check size={13} color="#2DD4BF" /> : <View style={{ width: 13 }} />}
                        <Text className="text-textSecondary text-xs ml-1.5" numberOfLines={1}>{m.id}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
            </>
          )}
        </Card>

        <Card title="Search Source" className="mb-4">
          <View className="flex-row flex-wrap gap-2">
            {SOURCES.map((s) => (
              <TouchableOpacity key={s} onPress={() => { setSearchSource(s); syncToDb({ settings: { searchSource: s } }); }} className={`px-3 py-2 rounded-lg border ${searchSource === s ? 'bg-primary/15 border-primary' : 'bg-surfaceHigh border-border'}`}>
                <Text className={`text-xs font-semibold capitalize ${searchSource === s ? 'text-primary' : 'text-textSecondary'}`}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Card>

        <Card title="Data" className="mb-4">
          <Row icon={<Download size={17} color="#2DD4BF" />} label="Export backup (JSON)" sub="Share or save a full portfolio backup" onPress={exportData} />
          <Row icon={<Upload size={17} color="#2DD4BF" />} label="Import backup" sub="Restore assets & settings from a JSON file" onPress={importData} />
          <Row icon={<RefreshCcw size={17} color="#8B5CF6" />} label="Restore from cloud backup" sub="Pull latest snapshot from the server backup" onPress={handleRestoreFromMongo} />
          <Row icon={<RefreshCw size={17} color="#FBBF24" />} label="Force refresh fund holdings" sub="Clear & re-download MF/ETF holdings data" onPress={() => { forceRefreshHoldings(); Alert.alert('Queued', 'Fund holdings will be re-fetched.'); }} />
          {restoreStatus ? (
            <View className={`mt-2 px-3 py-2 rounded-lg ${restoreStatus.isError ? 'bg-loss/10' : 'bg-profit/10'}`}>
              <Text className={`text-xs ${restoreStatus.isError ? 'text-loss' : 'text-profit'}`}>{restoreStatus.message}</Text>
            </View>
          ) : null}
        </Card>

        <Card className="mb-4">
          <Row
            icon={<LogOut size={17} color="#F87171" />}
            label="Sign out"
            sub={user?.email || ''}
            danger
            onPress={() => Alert.alert('Sign out', 'Are you sure?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Sign out', style: 'destructive', onPress: signOut },
            ])}
          />
          <Text className="text-textMuted text-[10px] text-center mt-3">Asset Allocation Tracker · v1.0.0</Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
