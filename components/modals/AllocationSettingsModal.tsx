import React, { Fragment } from 'react';
import { Target, X, Trash2 } from 'lucide-react';
import { normalizeGroup } from '@/lib/portfolio-utils';

interface AllocationSettingsModalProps {
  isAllocationSettingsOpen: boolean;
  setIsAllocationSettingsOpen: (val: boolean) => void;
  idealAllocation: Record<string, number>;
  setIdealAllocation: (val: Record<string, number>) => void;
  allCategories: string[];
  consolidatedAllocation: Record<string, number>;
  syncToDb: (data: any) => void;
}

export default function AllocationSettingsModal({
  isAllocationSettingsOpen,
  setIsAllocationSettingsOpen,
  idealAllocation,
  setIdealAllocation,
  allCategories,
  consolidatedAllocation,
  syncToDb,
}: AllocationSettingsModalProps) {
  if (!isAllocationSettingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-zinc-200 dark:border-zinc-800">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-500" />
            Ideal Asset Allocation
          </h2>
          <button onClick={() => setIsAllocationSettingsOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5 space-y-6">
          <div>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              Set your target percentage for each asset category. This helps track where your portfolio needs rebalancing.
            </p>
            <div className="space-y-3">
              {(() => {
                const grouped = allCategories.reduce((acc, cat) => {
                  const normalized = normalizeGroup(cat);
                  const [parent, child] = normalized.includes(' > ') ? normalized.split(' > ') : [normalized, null];
                  
                  if (!acc[parent]) acc[parent] = [];
                  
                  if (child) {
                    acc[parent].push({ full: cat, name: child, isSub: true });
                  } else {
                    if (!acc[parent].some(i => !i.isSub)) {
                      acc[parent].unshift({ full: cat, name: parent, isSub: false });
                    }
                  }
                  return acc;
                }, {} as Record<string, {full: string, name: string, isSub: boolean}[]>);

                return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([parent, children]) => (
                  <Fragment key={parent}>
                    {children.map((catObj) => (
                       <div key={catObj.full} className={`flex items-center gap-3 ${catObj.isSub ? 'pl-6' : ''}`}>
                         <label className={`w-1/3 text-sm text-zinc-600 dark:text-zinc-400 ${catObj.isSub ? 'text-xs' : ''}`}>
                           {catObj.name}
                         </label>
                         <input
                           type="number"
                           value={consolidatedAllocation[catObj.full] || 0}
                           onChange={(e) => {
                             const newAlloc = { ...idealAllocation };
                             Object.keys(newAlloc).forEach(k => {
                               if (normalizeGroup(k) === catObj.full) delete newAlloc[k];
                             });
                             newAlloc[catObj.full] = Number(e.target.value);
                             setIdealAllocation(newAlloc);
                             syncToDb({ settings: { idealAllocation: newAlloc } });
                           }}
                           className="w-1/3 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                         />
                         <div className="flex gap-1 w-1/3">
                           {!catObj.isSub && (
                             <input
                               type="text"
                               id={`newSubCategory-${catObj.full}`}
                               placeholder="New Sub"
                               className="w-full px-2 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 text-xs"
                             />
                           )}
                           {!catObj.isSub && (
                             <button
                               onClick={() => {
                                 const input = document.getElementById(`newSubCategory-${catObj.full}`) as HTMLInputElement;
                                 if (input.value) {
                                   const newKey = `${catObj.full} > ${input.value}`;
                                   const newAlloc = { ...idealAllocation, [newKey]: 0 };
                                   setIdealAllocation(newAlloc);
                                   syncToDb({ settings: { idealAllocation: newAlloc } });
                                   input.value = '';
                                 }
                               }}
                               className="px-2 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-xs"
                             >
                               Add
                             </button>
                           )}
                           <button
                             onClick={() => {
                               const newAlloc = { ...idealAllocation };
                               Object.keys(newAlloc).forEach(k => {
                                 if (normalizeGroup(k) === catObj.full) delete newAlloc[k];
                               });
                               setIdealAllocation(newAlloc);
                               syncToDb({ settings: { idealAllocation: newAlloc } });
                             }}
                             className="text-red-500 hover:text-red-600 px-1"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                         </div>
                       </div>
                    ))}
                  </Fragment>
                ));
              })()}
              <div className="flex items-center gap-3 mt-2">
                <input
                  type="text"
                  id="newCategoryName"
                  placeholder="New Category"
                  className="w-1/2 px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow"
                />
                <button
                  onClick={() => {
                    const input = document.getElementById('newCategoryName') as HTMLInputElement;
                    if (input.value) {
                      const newAlloc = { ...idealAllocation, [input.value]: 0 };
                      setIdealAllocation(newAlloc);
                      syncToDb({ settings: { idealAllocation: newAlloc } });
                      input.value = '';
                    }
                  }}
                  className="px-3 py-2 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                >
                  Add
                </button>
              </div>
              <div className="text-xs text-zinc-500 mt-2">
                Total: {Object.values(idealAllocation).reduce((a, b) => a + b, 0)}% (Should be 100%)
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
