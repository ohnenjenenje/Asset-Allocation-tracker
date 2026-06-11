import React from 'react';
import { X, Trash2 } from 'lucide-react';

interface ManualFundModalProps {
  manualFundModal: { isOpen: boolean; symbol: string; name: string; holdings: { name: string; holdingPercent: number }[] } | null;
  setManualFundModal: (val: any) => void;
  fundHoldings: Record<string, any>;
  syncToDb: (data: any) => void;
}

export default function ManualFundModal({
  manualFundModal,
  setManualFundModal,
  fundHoldings,
  syncToDb,
}: ManualFundModalProps) {
  if (!manualFundModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Edit Holdings: {manualFundModal.name}</h2>
          <button onClick={() => setManualFundModal(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {manualFundModal.holdings.map((h, i) => (
            <div key={`manual-holding-${h.name || 'new'}-${i}`} className="flex gap-2">
              <input
                type="text"
                value={h.name}
                onChange={(e) => {
                  const newHoldings = [...manualFundModal.holdings];
                  newHoldings[i].name = e.target.value;
                  setManualFundModal({ ...manualFundModal, holdings: newHoldings });
                }}
                placeholder="Holding Name"
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none"
              />
              <input
                type="number"
                value={h.holdingPercent}
                onChange={(e) => {
                  const newHoldings = [...manualFundModal.holdings];
                  newHoldings[i].holdingPercent = Number(e.target.value);
                  setManualFundModal({ ...manualFundModal, holdings: newHoldings });
                }}
                placeholder="%"
                className="w-20 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none"
              />
              <button onClick={() => {
                const newHoldings = manualFundModal.holdings.filter((_, idx) => idx !== i);
                setManualFundModal({ ...manualFundModal, holdings: newHoldings });
              }} className="text-red-500 hover:text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button onClick={() => {
            setManualFundModal({ ...manualFundModal, holdings: [...manualFundModal.holdings, { name: '', holdingPercent: 0 }] });
          }} className="w-full py-2 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            + Add Holding
          </button>
        </div>
        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
          <button onClick={() => setManualFundModal(null)} className="px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">Cancel</button>
          <button onClick={() => {
            const newFundHoldings = { 
              ...fundHoldings, 
              [manualFundModal.symbol]: { 
                ...fundHoldings[manualFundModal.symbol],
                holdings: manualFundModal.holdings,
                debug: null
              } 
            };
            syncToDb({ fundHoldings: newFundHoldings });
            setManualFundModal(null);
          }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Save</button>
        </div>
      </div>
    </div>
  );
}
