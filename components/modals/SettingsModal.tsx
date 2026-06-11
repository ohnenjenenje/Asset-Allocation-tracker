import React from 'react';
import { X, RefreshCw } from 'lucide-react';
import { Asset } from '@/lib/types';

interface SettingsModalProps {
  isSettingsOpen: boolean;
  setIsSettingsOpen: (val: boolean) => void;
  searchSource: 'indianapi' | 'yahoo' | 'newapi' | 'tickertape';
  setSearchSource: (val: 'indianapi' | 'yahoo' | 'newapi' | 'tickertape') => void;
  aiProvider: 'openrouter' | 'google';
  setAiProvider: (val: 'openrouter' | 'google') => void;
  openRouterKey: string;
  saveOpenRouterKey: (val: string) => void;
  availableModels: any[];
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  googleModel: string;
  setGoogleModel: (val: string) => void;
  handleExportData: () => void;
  handleImportData: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRestoreFromMongo: () => void;
  restoreStatus: { isError: boolean; message: string } | null;
  syncToDb: (data: any) => void;
  fetchPrices: (force?: boolean) => void;
  isLoadingPrices: boolean;
  assets: Asset[];
}

export default function SettingsModal({
  isSettingsOpen,
  setIsSettingsOpen,
  searchSource,
  setSearchSource,
  aiProvider,
  setAiProvider,
  openRouterKey,
  saveOpenRouterKey,
  availableModels,
  selectedModel,
  setSelectedModel,
  googleModel,
  setGoogleModel,
  handleExportData,
  handleImportData,
  handleRestoreFromMongo,
  restoreStatus,
  syncToDb,
  fetchPrices,
  isLoadingPrices,
  assets,
}: SettingsModalProps) {
  if (!isSettingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-zinc-200 dark:border-zinc-800">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">Settings</h2>
          <button onClick={() => setIsSettingsOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-6">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Stock Search Source</label>
            <select
              value={searchSource}
              onChange={(e) => {
                const val = e.target.value as 'indianapi' | 'yahoo' | 'newapi' | 'tickertape';
                setSearchSource(val);
                syncToDb({ settings: { searchSource: val } });
              }}
              className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
            >
              <option value="tickertape">Tickertape (Recommended)</option>
              <option value="indianapi">IndianAPI</option>
              <option value="yahoo">Yahoo Finance</option>
              <option value="newapi">New API (GitHub)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">AI Provider</label>
            <select
              value={aiProvider}
              onChange={(e) => {
                const val = e.target.value as 'openrouter' | 'google';
                setAiProvider(val);
                syncToDb({ settings: { aiProvider: val } });
              }}
              className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
            >
              <option value="openrouter">OpenRouter</option>
              <option value="google">Google Gemini (Built-in)</option>
            </select>
          </div>

          {aiProvider === 'openrouter' && (
            <>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">OpenRouter API Key</label>
                <input 
                  type="password" 
                  className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                  placeholder="sk-or-v1-..."
                  defaultValue={openRouterKey}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveOpenRouterKey(e.currentTarget.value);
                  }}
                  onBlur={(e) => saveOpenRouterKey(e.target.value)}
                />
                <p className="text-xs text-zinc-500 mt-2">
                  Required to use the AI Assistant. Get one at <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">openrouter.ai</a>.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">AI Model</label>
                <div className="flex flex-col gap-2">
                  <select
                    value={availableModels.some(m => m.id === selectedModel) || selectedModel === 'meta-llama/llama-3.3-70b-instruct:free' ? selectedModel : 'custom'}
                    onChange={(e) => {
                      if (e.target.value === 'custom') {
                        setSelectedModel('');
                        syncToDb({ settings: { openrouterModel: '' } });
                      } else {
                        setSelectedModel(e.target.value);
                        syncToDb({ settings: { openrouterModel: e.target.value } });
                      }
                    }}
                    className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
                  >
                    <option value="meta-llama/llama-3.3-70b-instruct:free">Meta Llama 3.3 70B (Free, Best for Tools)</option>
                    {availableModels.map(model => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                    <option value="custom">Custom Model...</option>
                  </select>
                  
                  {(!availableModels.some(m => m.id === selectedModel) && selectedModel !== 'meta-llama/llama-3.3-70b-instruct:free') && (
                    <input
                      type="text"
                      value={selectedModel}
                      onChange={(e) => {
                        setSelectedModel(e.target.value);
                        syncToDb({ settings: { openrouterModel: e.target.value } });
                      }}
                      placeholder="e.g., anthropic/claude-3-opus"
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      autoFocus
                    />
                  )}
                </div>
                <p className="text-xs text-zinc-500 mt-2">
                  Select a free model from the list or choose &quot;Custom Model...&quot; to type any OpenRouter model ID.
                </p>
              </div>
            </>
          )}

          {aiProvider === 'google' && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Gemini Model</label>
              <select
                value={googleModel}
                onChange={(e) => {
                  setGoogleModel(e.target.value);
                  syncToDb({ settings: { googleModel: e.target.value } });
                }}
                className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow appearance-none"
              >
                <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash Lite (Fast & Efficient)</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Advanced Reasoning)</option>
                <option value="gemini-flash-latest">Gemini Flash (Legacy Stable)</option>
              </select>
              <p className="text-xs text-zinc-500 mt-2">
                Uses the built-in Gemini API key provided by the platform.
              </p>
            </div>
          )}

          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mb-3">Data Management</h3>
            <div className="flex gap-3">
              <button
                onClick={handleExportData}
                className="flex-1 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl font-medium transition-colors text-sm"
              >
                Export Backup
              </button>
              <label className="flex-1 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl font-medium transition-colors text-sm text-center cursor-pointer">
                Import Backup
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportData}
                  className="hidden"
                />
              </label>
            </div>
            <p className="text-xs text-zinc-500 mt-2 text-center">
              Export your portfolio data to transfer it to a different Google account.
            </p>
            <div className="mt-3 flex flex-col gap-2">
              <button
                onClick={handleRestoreFromMongo}
                className="w-full px-4 py-2 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-zinc-100 rounded-xl font-medium transition-colors text-sm text-center relative overflow-hidden"
              >
                Restore from MongoDB Backup
                {restoreStatus && (
                  <div className={`absolute inset-0 flex items-center justify-center font-medium ${restoreStatus.isError ? 'bg-red-50 text-red-600 dark:bg-red-900/40 dark:text-red-400' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'}`}>
                    {restoreStatus.message}
                  </div>
                )}
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <button
              onClick={() => {
                fetchPrices(true);
                setIsSettingsOpen(false);
              }}
              disabled={isLoadingPrices || assets.length === 0}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-medium hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoadingPrices ? 'animate-spin' : ''}`} />
              <span>Full Refresh (Sync with Tickertape)</span>
            </button>
            <p className="text-[10px] text-zinc-500 mt-2 text-center">
              This will force a re-fetch of all asset data from Tickertape and other sources, bypassing cached data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
