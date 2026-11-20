import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { apiFetch } from '@/src/lib/api/client';

import {
  isAssetSearchReady,
  normalizeSearchResults,
  type AssetSearchResult,
} from './searchResults';

export type { AssetSearchResult, AssetSearchSelection } from './searchResults';
export { mapSearchResult } from './searchResults';

const DEBOUNCE_MS = 450;

export const assetSearchKeys = {
  query: (query: string) => ['asset-search', query] as const,
};

/**
 * Mirrors the web dashboard: the backend combines Yahoo Finance with the MFAPI
 * mutual-fund list, so a partial name like "reli" returns Indian equities too.
 */
export async function fetchAssetSearch(
  query: string,
  options: { signal?: AbortSignal; source?: 'tickertape' | 'yahoo' } = {},
): Promise<AssetSearchResult[]> {
  const params = new URLSearchParams({
    q: query.trim(),
    source: options.source ?? 'tickertape',
  });
  const payload = await apiFetch<unknown>(`/api/search?${params.toString()}`, {
    signal: options.signal,
    timeoutMs: 30_000,
  });
  return normalizeSearchResults(payload);
}

/**
 * Debounced suggestion query. A 450 ms pause avoids firing a request on every
 * keystroke while still feeling immediate on a phone connection.
 */
export function useAssetSearch(query: string, enabled = true) {
  const [debounced, setDebounced] = useState(query);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmed = debounced.trim();

  return useQuery({
    queryKey: assetSearchKeys.query(trimmed),
    queryFn: ({ signal }) => fetchAssetSearch(trimmed, { signal }),
    enabled: enabled && isAssetSearchReady(trimmed),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}
