import React, { useState, useMemo } from 'react';
import { Target, X, Plus, Trash2, ChevronRight, ChevronDown } from 'lucide-react';
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

// Helper to build a nested tree
const buildTree = (categories: string[]) => {
  const root: any = {};
  categories.forEach(cat => {
    const parts = cat.split(' > ').map(s => s.trim());
    let current = root;
    let path = '';
    parts.forEach((part, i) => {
      path = path ? `${path} > ${part}` : part;
      if (!current[part]) {
        current[part] = { _path: path, _children: {} };
      }
      current = current[part]._children;
    });
  });
  return root;
};

const TreeNode = ({ nodeKey, node, idealAllocation, consolidatedAllocation, handleAllocationChange, depth = 0 }: any) => {
  const path = node._path;
  const childrenKeys = Object.keys(node._children);
  const hasChildren = childrenKeys.length > 0;
  const [isExpanded, setIsExpanded] = useState(true);
  
  // New state for adding sub-categories
  const [isAdding, setIsAdding] = useState(false);
  const [newSubName, setNewSubName] = useState('');

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubName.trim()) {
      setIsAdding(false);
      return;
    }
    const newPath = `${path} > ${newSubName.trim()}`;
    handleAllocationChange(newPath, 0); // Initialize with 0%
    setNewSubName('');
    setIsAdding(false);
    setIsExpanded(true); // Auto expand to show the new child
  };

  const childrenSum = childrenKeys.reduce((sum, k) => {
    const childPath = node._children[k]._path;
    const val = idealAllocation[childPath] !== undefined ? idealAllocation[childPath] : (consolidatedAllocation[childPath] || 0);
    return sum + (Number(val) || 0);
  }, 0);

  const paddingLeft = depth * 1.5;

  return (
    <div className="flex flex-col mb-2">
      <div 
        className={`flex items-center justify-between p-2 rounded-lg ${depth === 0 ? 'bg-zinc-100 dark:bg-zinc-800/80 font-semibold' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/30'}`}
        style={{ marginLeft: `${paddingLeft}rem` }}
      >
        <div className="flex items-center gap-2">
          {hasChildren ? (
            <button onClick={() => setIsExpanded(!isExpanded)} className="text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          ) : (
            <div className="w-4 h-4" />
          )}
          <span className={`text-sm ${depth === 0 ? 'text-zinc-900 dark:text-zinc-100' : 'text-zinc-700 dark:text-zinc-300'}`}>
            {nodeKey}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={idealAllocation[path] !== undefined ? idealAllocation[path] : (consolidatedAllocation[path] || '')}
            onChange={(e) => {
              const val = e.target.value;
              handleAllocationChange(path, val === '' ? '' : parseFloat(val));
            }}
            className={`w-20 px-2 py-1 text-sm border rounded bg-white dark:bg-zinc-900 ${depth === 0 ? 'border-zinc-300 dark:border-zinc-600 font-semibold' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 focus:border-blue-500'} focus:outline-none text-right`}
            placeholder="0"
          />
          <span className="text-sm text-zinc-500 dark:text-zinc-400 w-4">%</span>
        </div>
      </div>
      
      {(hasChildren || isExpanded) && isExpanded && (
        <div className="flex flex-col mt-1">
          {childrenKeys.map(k => (
            <TreeNode 
              key={k} 
              nodeKey={k} 
              node={node._children[k]} 
              idealAllocation={idealAllocation}
              consolidatedAllocation={consolidatedAllocation} 
              handleAllocationChange={handleAllocationChange} 
              depth={depth + 1} 
            />
          ))}
          
          {isAdding ? (
            <form onSubmit={handleAddSubmit} className="flex items-center gap-2 mt-2" style={{ marginLeft: `${paddingLeft + 1.5}rem` }}>
              <input
                autoFocus
                type="text"
                value={newSubName}
                onChange={(e) => setNewSubName(e.target.value)}
                placeholder="Sub-category name..."
                className="flex-1 px-2 py-1 text-xs border border-zinc-300 dark:border-zinc-600 rounded bg-white dark:bg-zinc-900 focus:outline-none focus:border-blue-500 text-zinc-800 dark:text-zinc-200"
              />
              <button type="submit" className="text-xs px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded font-medium">Add</button>
              <button type="button" onClick={() => setIsAdding(false)} className="text-zinc-400 hover:text-zinc-600"><X className="w-4 h-4" /></button>
            </form>
          ) : (
            <div style={{ marginLeft: `${paddingLeft + 1.5}rem` }} className="mt-1 mb-2">
              <button onClick={() => setIsAdding(true)} className="flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-blue-500 hover:text-blue-600 transition-colors">
                <Plus className="w-3 h-3" /> Add Sub-category
              </button>
            </div>
          )}

          {hasChildren && (
            <div 
              className="flex items-center justify-between py-1 pr-6 mt-1 text-[11px]"
              style={{ marginLeft: `${paddingLeft + 1.5}rem` }}
            >
              <span className="text-zinc-500">Sub-categories sum:</span>
              <span className={`font-semibold ${childrenSum === 100 ? 'text-emerald-500' : 'text-red-500'}`}>
                {childrenSum}% {childrenSum !== 100 && '(Should be 100%)'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default function AllocationSettingsModal({
  isAllocationSettingsOpen,
  setIsAllocationSettingsOpen,
  idealAllocation,
  setIdealAllocation,
  allCategories,
  consolidatedAllocation,
  syncToDb,
}: AllocationSettingsModalProps) {
  
  const tree = useMemo(() => buildTree(allCategories), [allCategories]);

  const handleAllocationChange = (category: string, value: any) => {
    const updated = { ...idealAllocation, [category]: value };
    setIdealAllocation(updated);
  };

  const handleSave = () => {
    syncToDb({ settings: { idealAllocation } });
    setIsAllocationSettingsOpen(false);
  };

  if (!isAllocationSettingsOpen) return null;

  // Root level sum
  const rootKeys = Object.keys(tree);
  const rootSum = rootKeys.reduce((sum, k) => {
    const val = idealAllocation[tree[k]._path] !== undefined ? idealAllocation[tree[k]._path] : (consolidatedAllocation[tree[k]._path] || 0);
    return sum + (Number(val) || 0);
  }, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-md overflow-hidden flex flex-col border border-zinc-200 dark:border-zinc-800 max-h-[85vh]">
        <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex justify-between items-center bg-zinc-50 dark:bg-zinc-900/50">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-500" />
            Hierarchical Allocation
          </h2>
          <button onClick={() => setIsAllocationSettingsOpen(false)} className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-5 overflow-y-auto flex-1 bg-white dark:bg-zinc-950">
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-5 leading-relaxed bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-100 dark:border-blue-800/30">
            Set your target percentages hierarchically. Root categories (like Equities) represent a % of your <strong>total portfolio</strong>. Sub-categories represent a % of their <strong>parent bucket</strong>.
          </p>
          
          <div className="space-y-2">
            {rootKeys.map(k => (
              <TreeNode 
                key={k} 
                nodeKey={k} 
                node={tree[k]} 
                idealAllocation={idealAllocation}
                consolidatedAllocation={consolidatedAllocation} 
                handleAllocationChange={handleAllocationChange} 
              />
            ))}
          </div>
          
        </div>
        
        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 flex flex-col gap-3">
          <div className="flex justify-between items-center px-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Total Portfolio Sum:</span>
            <span className={`text-sm font-bold ${rootSum === 100 ? 'text-emerald-500' : 'text-red-500'}`}>
              {rootSum}%
            </span>
          </div>
          <button
            onClick={handleSave}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-sm"
          >
            Save Target Allocation
          </button>
        </div>
      </div>
    </div>
  );
}