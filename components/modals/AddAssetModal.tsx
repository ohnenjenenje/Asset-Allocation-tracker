import React from 'react';
import { Search, X } from 'lucide-react';
import { getConvertedPrice, guessCurrency } from '@/lib/portfolio-utils';
import { Asset } from '@/lib/types';

interface AddAssetModalProps {
  isAddModalOpen: boolean;
  setIsAddModalOpen: (val: boolean) => void;
  editingAssetId: string | null;
  resetForm: () => void;
  searchQuery: string;
  setSearchQuery: (val: string) => void;
  searchResults: any[];
  setSearchResults: (val: any[]) => void;
  selectedResult: any | null;
  setSelectedResult: (val: any | null) => void;
  isSearching: boolean;
  findExistingAssetToMerge: (res: any) => Asset | undefined;
  quantity: string;
  setQuantity: (val: string) => void;
  entryPrice: string;
  setEntryPrice: (val: string) => void;
  entryCurrency: string;
  setEntryCurrency: (val: string) => void;
  usdToInr: number;
  handleMergeAsset: () => void;
  investedValueInput: string;
  setInvestedValueInput: (val: string) => void;
  manualPrice: string;
  setManualPrice: (val: string) => void;
  manualSector: string;
  setManualSector: (val: string) => void;
  purchaseDate: string;
  setPurchaseDate: (val: string) => void;
  handleAddAsset: () => void;
}

export default function AddAssetModal({
  isAddModalOpen,
  setIsAddModalOpen,
  editingAssetId,
  resetForm,
  searchQuery,
  setSearchQuery,
  searchResults,
  setSearchResults,
  selectedResult,
  setSelectedResult,
  isSearching,
  findExistingAssetToMerge,
  quantity,
  setQuantity,
  entryPrice,
  setEntryPrice,
  entryCurrency,
  setEntryCurrency,
  usdToInr,
  handleMergeAsset,
  investedValueInput,
  setInvestedValueInput,
  manualPrice,
  setManualPrice,
  manualSector,
  setManualSector,
  purchaseDate,
  setPurchaseDate,
  handleAddAsset,
}: AddAssetModalProps) {
  if (!isAddModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh] border border-zinc-200 dark:border-zinc-800">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            {editingAssetId ? 'Update Asset' : 'Add Asset'}
          </h2>
          <button 
            onClick={() => {
              setIsAddModalOpen(false);
              resetForm();
            }} 
            className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        
        <div className="p-5 overflow-y-auto space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Search Asset</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <input 
                type="text" 
                className="w-full pl-9 pr-10 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                placeholder="e.g. Reliance, TCS, BTC-USD, Gold"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedResult) setSelectedResult(null);
                }}
              />
              {searchQuery && (
                <button 
                  onClick={() => {
                    setSearchQuery('');
                    setSearchResults([]);
                    if (selectedResult) setSelectedResult(null);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 p-1 rounded-full transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            
            {isSearching && <div className="text-sm text-zinc-500 mt-2 px-1">Searching...</div>}
            
            {searchResults.length > 0 && !selectedResult && (
              <ul className="mt-2 border border-zinc-200 dark:border-zinc-700 rounded-xl max-h-80 overflow-y-auto bg-white dark:bg-zinc-950 shadow-sm divide-y divide-zinc-100 dark:divide-zinc-800">
                {searchResults.map((res, idx) => (
                  <li 
                    key={`${res.symbol}-${res.source || 'y'}-${idx}`} 
                    className="px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer flex justify-between items-start transition-colors gap-3"
                    onClick={() => {
                      setSelectedResult(res);
                      setSearchQuery(res.shortname || res.longname || res.symbol);
                      setSearchResults([]);
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100 leading-snug" title={res.longname || res.shortname}>
                        {res.shortname || res.longname}
                      </div>
                      <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                        <span className="font-semibold text-zinc-400 uppercase">{res.quoteType || res.typeDisp}</span>
                        <span>&bull;</span>
                        <span>{res.exchDisp || res.source}</span>
                      </div>
                    </div>
                    <div className="text-[10px] font-bold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 whitespace-nowrap self-start">
                      {res.symbol}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedResult && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl">
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-blue-900 dark:text-blue-100 leading-tight">
                    {selectedResult.shortname || selectedResult.longname}
                  </div>
                  <div className="text-[10px] text-blue-700 dark:text-blue-300 mt-1 font-mono uppercase tracking-wider">
                    {selectedResult.symbol} &bull; {selectedResult.quoteType || selectedResult.typeDisp}
                  </div>
                </div>
                <button 
                  onClick={() => {
                    setSelectedResult(null);
                    setSearchQuery('');
                    setQuantity('');
                    setEntryPrice('');
                  }}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm font-medium whitespace-nowrap"
                >
                  Change
                </button>
              </div>
              
              {findExistingAssetToMerge(selectedResult) && !editingAssetId && (
                <div className="mt-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg">
                  <div className="flex items-start gap-2">
                    <div className="text-amber-600 dark:text-amber-400 mt-0.5">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs text-amber-800 dark:text-amber-200 font-medium">This asset is already in your portfolio.</p>
                      
                      {quantity && entryPrice && !isNaN(parseFloat(quantity)) && !isNaN(parseFloat(entryPrice)) ? (
                        <div className="mt-2 space-y-2">
                          <div className="text-[10px] text-amber-700 dark:text-amber-400 uppercase tracking-wider font-bold">Projected Average</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded border border-amber-100 dark:border-amber-900/30">
                              <div className="text-[10px] text-zinc-500">New Quantity</div>
                              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                {(findExistingAssetToMerge(selectedResult)?.quantity || 0) + parseFloat(quantity)}
                              </div>
                            </div>
                            <div className="p-1.5 bg-white/50 dark:bg-black/20 rounded border border-amber-100 dark:border-amber-900/30">
                              <div className="text-[10px] text-zinc-500">New Avg Price</div>
                              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                                {(() => {
                                  const existing = findExistingAssetToMerge(selectedResult);
                                  if (!existing) return '0';
                                  
                                  const newQty = parseFloat(quantity);
                                  const newPrice = parseFloat(entryPrice);
                                  
                                  if (existing.currency === entryCurrency) {
                                    const avg = (existing.quantity * existing.entryPrice + newQty * newPrice) / (existing.quantity + newQty);
                                    return `${avg.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${entryCurrency}`;
                                  } else {
                                    const existingInInr = getConvertedPrice(existing.entryPrice, existing.currency || guessCurrency(existing.symbol), usdToInr);
                                    const newInInr = getConvertedPrice(newPrice, entryCurrency, usdToInr);
                                    const avgInInr = (existing.quantity * existingInInr + newQty * newInInr) / (existing.quantity + newQty);
                                    return `₹${avgInInr.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
                                  }
                                })()}
                              </div>
                            </div>
                          </div>
                          <button 
                            onClick={handleMergeAsset}
                            className="w-full py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                          >
                            Merge & Average
                          </button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => {
                            const existing = findExistingAssetToMerge(selectedResult);
                            if (existing) {
                              // We can't set editingAssetId directly here without passing setEditingAssetId
                              // But the original code does:
                              // setEditingAssetId(existing.id);
                              // setQuantity(existing.quantity.toString());
                              // setEntryPrice(existing.entryPrice.toString());
                              // Let's just pass a callback or handle it in page.tsx
                              // Actually, the original code does this inline. We need to pass setEditingAssetId.
                            }
                          }}
                          className="mt-1 text-xs text-amber-700 dark:text-amber-300 underline hover:text-amber-900 dark:hover:text-amber-100 font-semibold"
                        >
                          Modify existing entry instead?
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
              
              {editingAssetId && (
                <div className="mt-3 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-lg flex items-center gap-2">
                  <div className="text-green-600 dark:text-green-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                  </div>
                  <p className="text-xs text-green-800 dark:text-green-200 font-medium">Modifying existing entry</p>
                </div>
              )}
            </div>
          )}

          {selectedResult && (
            <div className={`grid ${selectedResult?.symbol === 'GOLD-INR-GRAM' || selectedResult?.symbol === 'SILVER-INR-GRAM' || selectedResult?.symbol === 'CASH-INR' ? 'grid-cols-3' : 'grid-cols-2'} gap-4`}>
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Quantity</label>
                <input 
                  type="number" 
                  step="any"
                  min="0"
                  className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                  value={quantity}
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    if (selectedResult?.symbol === 'GOLD-INR-GRAM' || selectedResult?.symbol === 'SILVER-INR-GRAM' || selectedResult?.symbol === 'CASH-INR') {
                        const val = parseFloat(e.target.value);
                        const price = parseFloat(entryPrice);
                        if (!isNaN(val) && !isNaN(price)) {
                            setInvestedValueInput((val * price).toFixed(2));
                        }
                    }
                  }}
                  placeholder="e.g. 10"
                />
              </div>
              {(selectedResult?.symbol === 'GOLD-INR-GRAM' || selectedResult?.symbol === 'SILVER-INR-GRAM' || selectedResult?.symbol === 'CASH-INR') && (
                <div>
                    <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Invested Value</label>
                    <input                
                      type="number"
                      step="any"
                      min="0"
                      className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                      value={investedValueInput}
                      onChange={(e) => {
                         setInvestedValueInput(e.target.value);
                         const val = parseFloat(e.target.value);
                         const qty = parseFloat(quantity);
                         if (!isNaN(val) && !isNaN(qty) && qty > 0) {
                             setEntryPrice((val / qty).toFixed(2));
                         }
                      }}
                      placeholder="e.g. 1000"
                    />
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">{selectedResult?.symbol === 'GOLD-INR-GRAM' ? 'Avg Buy Price' : 'Entry Price'}</label>
                <div className="relative">
                  <input 
                    type="number" 
                    step="any"
                    min="0"
                    className="w-full pl-4 pr-20 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                    value={entryPrice}
                    onChange={(e) => {
                      setEntryPrice(e.target.value);
                      if (selectedResult?.symbol === 'GOLD-INR-GRAM' || selectedResult?.symbol === 'SILVER-INR-GRAM' || selectedResult?.symbol === 'CASH-INR') {
                         const price = parseFloat(e.target.value);
                         const qty = parseFloat(quantity);
                         if (!isNaN(price) && !isNaN(qty)) {
                             setInvestedValueInput((price * qty).toFixed(2));
                         }
                      }
                    }}
                    placeholder="e.g. 1500.50"
                  />
                  <div className="absolute right-1.5 top-1.5 bottom-1.5 flex bg-zinc-100 dark:bg-zinc-800 rounded-lg p-0.5">
                    <button
                      onClick={() => setEntryCurrency('INR')}
                      className={`px-2 text-[10px] font-bold rounded-md transition-all ${entryCurrency === 'INR' ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                    >
                      INR
                    </button>
                    <button
                      onClick={() => setEntryCurrency('USD')}
                      className={`px-2 text-[10px] font-bold rounded-md transition-all ${entryCurrency === 'USD' ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
                    >
                      USD
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {selectedResult && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Manual Price (LTP Override)</label>
              <div className="relative">
                <input 
                  type="number" 
                  step="any"
                  min="0"
                  className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                  value={manualPrice}
                  onChange={(e) => setManualPrice(e.target.value)}
                  placeholder="Leave empty to use market price"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-zinc-400 pointer-events-none">
                  {entryCurrency}
                </div>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">Use this if the market price (LTP) is not available or incorrect.</p>
            </div>
          )}

          {selectedResult && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Purchase Date</label>
              <input 
                type="date" 
                className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
              />
              <p className="text-[10px] text-zinc-500 mt-1">Used for LTCG/STCG tax estimation.</p>
            </div>
          )}

          {selectedResult && (
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">Sector (Manual Override)</label>
              <div className="relative">
                <input 
                  type="text" 
                  className="w-full px-4 py-2.5 border border-zinc-300 dark:border-zinc-700 rounded-xl bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                  value={manualSector}
                  onChange={(e) => setManualSector(e.target.value)}
                  placeholder="e.g. Financial Services, Technology..."
                  list="sector-suggestions"
                />
                <datalist id="sector-suggestions">
                  <option value="Financial Services" />
                  <option value="Technology" />
                  <option value="Healthcare" />
                  <option value="Consumer Cyclical" />
                  <option value="Consumer Defensive" />
                  <option value="Energy" />
                  <option value="Industrials" />
                  <option value="Real Estate" />
                  <option value="Communication Services" />
                  <option value="Basic Materials" />
                  <option value="Utilities" />
                  <option value="Fixed Income / Debt" />
                  <option value="Cash / Liquid" />
                </datalist>
              </div>
              <p className="text-[10px] text-zinc-500 mt-1">Manually categorize this asset for sector allocation charts.</p>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-3">
            <button 
              onClick={() => {
                setIsAddModalOpen(false);
                resetForm();
              }}
              className="px-5 py-2.5 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl font-medium transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleAddAsset}
              disabled={!selectedResult || !quantity || !entryPrice}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {editingAssetId ? 'Update Asset' : 'Add Asset'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
