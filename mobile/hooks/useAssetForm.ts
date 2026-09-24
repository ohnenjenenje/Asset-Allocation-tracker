import { useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Asset } from '@/lib/types';
import { apiFetch } from '@/lib/api';
import { getConvertedPrice, guessCurrency, isSameCrypto } from '@/lib/portfolio-utils';
import { useDashboard } from '@/hooks/useDashboardData';

export function useAssetForm(usdToInr: number) {
  const { assets, setAssets, syncToDb, searchSource } = useDashboard();

  const [isOpen, setIsOpen] = useState(false);
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selectedResult, setSelectedResult] = useState<any | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [entryPrice, setEntryPrice] = useState('');
  const [investedValueInput, setInvestedValueInput] = useState('');
  const [entryCurrency, setEntryCurrency] = useState('INR');
  const [manualPrice, setManualPrice] = useState('');
  const [manualSector, setManualSector] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');

  const resetForm = () => {
    setEditingAssetId(null);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedResult(null);
    setQuantity('');
    setEntryPrice('');
    setInvestedValueInput('');
    setEntryCurrency('INR');
    setManualPrice('');
    setManualSector('');
    setPurchaseDate('');
  };

  const openForAdd = () => { resetForm(); setIsOpen(true); };

  const openForEdit = (asset: Asset) => {
    resetForm();
    setEditingAssetId(asset.id);
    setSelectedResult({
      symbol: asset.symbol,
      shortname: asset.name,
      quoteType: asset.type,
    });
    setSearchQuery(asset.name || asset.symbol);
    setQuantity(String(asset.quantity ?? ''));
    setEntryPrice(String(asset.entryPrice ?? ''));
    setEntryCurrency(asset.currency || guessCurrency(asset.symbol));
    setManualPrice(asset.manualPrice != null ? String(asset.manualPrice) : '');
    setManualSector(asset.manualSector || '');
    setPurchaseDate(asset.purchaseDate || '');
    setIsOpen(true);
  };

  // Debounced search
  useEffect(() => {
    const t = setTimeout(async () => {
      if (searchQuery.length > 1 && !selectedResult) {
        setIsSearching(true);
        try {
          const res = await apiFetch(`/api/search?q=${encodeURIComponent(searchQuery)}&source=${searchSource}`);
          const text = await res.text();
          let data: any;
          try { data = JSON.parse(text); } catch { setSearchResults([]); return; }
          setSearchResults(res.ok && Array.isArray(data) ? data : []);
        } catch {
          setSearchResults([]);
        } finally {
          setIsSearching(false);
        }
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [searchQuery, selectedResult, searchSource]);

  useEffect(() => {
    if (selectedResult && !editingAssetId) setEntryCurrency(guessCurrency(selectedResult.symbol));
  }, [selectedResult, editingAssetId]);

  const findExistingAssetToMerge = (res: any) => {
    if (!res) return undefined;
    return assets.find((a) =>
      a.symbol === res.symbol ||
      isSameCrypto(a.symbol, res.symbol, a.type, res.quoteType || res.type),
    );
  };

  const finaleClose = () => { setIsOpen(false); resetForm(); };

  const handleAddAsset = () => {
    if (!selectedResult || !quantity || !entryPrice) return;
    let newAssets: Asset[];
    if (editingAssetId) {
      newAssets = assets.map((a) => a.id === editingAssetId ? {
        ...a,
        quantity: parseFloat(quantity),
        entryPrice: parseFloat(entryPrice),
        manualPrice: manualPrice ? parseFloat(manualPrice) : undefined,
        manualSector: manualSector || undefined,
        purchaseDate: purchaseDate || undefined,
        currency: entryCurrency,
      } : a);
    } else {
      const newAsset: Asset = {
        id: uuidv4(),
        symbol: selectedResult.symbol,
        name: selectedResult.shortname || selectedResult.longname || selectedResult.symbol,
        quantity: parseFloat(quantity),
        entryPrice: parseFloat(entryPrice),
        manualPrice: manualPrice ? parseFloat(manualPrice) : undefined,
        manualSector: manualSector || undefined,
        purchaseDate: purchaseDate || undefined,
        currency: entryCurrency,
        type: selectedResult.quoteType || 'UNKNOWN',
      };
      newAssets = [...assets, newAsset];
    }
    setAssets(newAssets);
    syncToDb({ assets: newAssets });
    finaleClose();
  };

  const handleMergeAsset = () => {
    if (!selectedResult || !quantity || !entryPrice) return;
    const existing = findExistingAssetToMerge(selectedResult);
    if (!existing) return;

    const newQty = parseFloat(quantity);
    const newPrice = parseFloat(entryPrice);
    const existingEntryInInr = getConvertedPrice(existing.entryPrice, existing.currency || guessCurrency(existing.symbol), usdToInr);
    const newEntryInInr = getConvertedPrice(newPrice, entryCurrency, usdToInr);
    const totalQty = existing.quantity + newQty;
    const avgInInr = (existing.quantity * existingEntryInInr + newQty * newEntryInInr) / totalQty;

    const finalCurrency = existing.currency === entryCurrency ? existing.currency : 'INR';
    const finalPrice = existing.currency === entryCurrency
      ? (existing.quantity * existing.entryPrice + newQty * newPrice) / totalQty
      : avgInInr;

    const newAssets = assets.map((a) => a.id === existing.id ? {
      ...a,
      quantity: totalQty,
      entryPrice: finalPrice,
      manualPrice: manualPrice ? parseFloat(manualPrice) : a.manualPrice,
      manualSector: manualSector || a.manualSector,
      currency: finalCurrency,
    } : a);

    setAssets(newAssets);
    syncToDb({ assets: newAssets });
    finaleClose();
  };

  const confirmDelete = (id: string) => {
    const newAssets = assets.filter((a) => a.id !== id);
    setAssets(newAssets);
    syncToDb({ assets: newAssets });
  };

  return {
    isOpen, setIsOpen, openForAdd, openForEdit, resetForm,
    editingAssetId, searchQuery, setSearchQuery, searchResults, setSearchResults,
    selectedResult, setSelectedResult, isSearching,
    quantity, setQuantity, entryPrice, setEntryPrice,
    investedValueInput, setInvestedValueInput,
    entryCurrency, setEntryCurrency,
    manualPrice, setManualPrice, manualSector, setManualSector,
    purchaseDate, setPurchaseDate,
    findExistingAssetToMerge, handleAddAsset, handleMergeAsset, confirmDelete,
  };
}

export type AssetForm = ReturnType<typeof useAssetForm>;
