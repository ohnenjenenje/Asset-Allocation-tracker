import React from 'react';
import { X, Trash2 } from 'lucide-react';

interface ManualSectorModalProps {
  manualSectorModal: { isOpen: boolean; symbol: string; name: string; sectors: { sector: string; percentage: number }[] } | null;
  setManualSectorModal: (val: any) => void;
  fundHoldings: Record<string, any>;
  syncToDb: (data: any) => void;
}

export default function ManualSectorModal({
  manualSectorModal,
  setManualSectorModal,
  fundHoldings,
  syncToDb,
}: ManualSectorModalProps) {
  if (!manualSectorModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Edit Sectors: {manualSectorModal.name}</h2>
          <button onClick={() => setManualSectorModal(null)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
          {manualSectorModal.sectors.map((s, i) => (
            <div key={`manual-sector-${s.sector || 'new'}-${i}`} className="flex gap-2">
              <select
                value={s.sector}
                onChange={(e) => {
                  const newSectors = [...manualSectorModal.sectors];
                  newSectors[i].sector = e.target.value;
                  setManualSectorModal({ ...manualSectorModal, sectors: newSectors });
                }}
                className="flex-1 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none"
              >
                <option value="">Select Sector</option>
                {['Technology', 'Financial Services', 'Healthcare', 'Consumer Cyclical', 'Consumer Defensive', 'Energy', 'Industrials', 'Real Estate', 'Communication Services', 'Basic Materials', 'Utilities', 'Other'].map((sector, sIdx) => (
                  <option key={`sector-opt-${sector}-${sIdx}`} value={sector}>{sector}</option>
                ))}
              </select>
              <input
                type="number"
                value={s.percentage}
                onChange={(e) => {
                  const newSectors = [...manualSectorModal.sectors];
                  newSectors[i].percentage = Number(e.target.value);
                  setManualSectorModal({ ...manualSectorModal, sectors: newSectors });
                }}
                placeholder="%"
                className="w-20 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 outline-none"
              />
              <button onClick={() => {
                const newSectors = manualSectorModal.sectors.filter((_, idx) => idx !== i);
                setManualSectorModal({ ...manualSectorModal, sectors: newSectors });
              }} className="text-red-500 hover:text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button onClick={() => {
            setManualSectorModal({ ...manualSectorModal, sectors: [...manualSectorModal.sectors, { sector: '', percentage: 0 }] });
          }} className="w-full py-2 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
            + Add Sector
          </button>
        </div>
        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
          <button onClick={() => setManualSectorModal(null)} className="px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">Cancel</button>
          <button onClick={() => {
            const newFundHoldings = { 
              ...fundHoldings, 
              [manualSectorModal.symbol]: { 
                ...fundHoldings[manualSectorModal.symbol],
                sectorWeightings: manualSectorModal.sectors,
                debug: null
              } 
            };
            syncToDb({ fundHoldings: newFundHoldings });
            setManualSectorModal(null);
          }} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">Save</button>
        </div>
      </div>
    </div>
  );
}
