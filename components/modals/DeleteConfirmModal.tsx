import React from 'react';
import { Asset } from '@/lib/types';

interface DeleteConfirmModalProps {
  assetToDelete: string | null;
  setAssetToDelete: (val: string | null) => void;
  confirmDelete: () => void;
  assets: Asset[];
}

export default function DeleteConfirmModal({
  assetToDelete,
  setAssetToDelete,
  confirmDelete,
  assets,
}: DeleteConfirmModalProps) {
  if (!assetToDelete) return null;

  const asset = assets.find(a => a.id === assetToDelete);
  const assetName = asset ? asset.name : 'this asset';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-xl w-full max-w-sm overflow-hidden border border-zinc-200 dark:border-zinc-800">
        <div className="p-5">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Delete Asset</h2>
          <p className="text-zinc-600 dark:text-zinc-400 mt-2">
            Are you sure you want to delete {assetName}? This action cannot be undone.
          </p>
        </div>
        <div className="p-5 border-t border-zinc-200 dark:border-zinc-800 flex justify-end gap-3">
          <button 
            onClick={() => setAssetToDelete(null)}
            className="px-4 py-2 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={confirmDelete}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
