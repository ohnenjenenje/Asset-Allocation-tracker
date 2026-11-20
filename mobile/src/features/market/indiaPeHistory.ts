import { useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch } from '@/src/lib/api/client';

export interface IndiaPeHistoryPoint {
  /** Calendar month in `YYYY-MM` form. */
  month: string;
  pe: number;
}

export interface IndiaPeHistoryData {
  key: string;
  name: string;
  category: 'broad' | 'sector' | 'thematic';
  source: 'nse';
  months: IndiaPeHistoryPoint[];
}

interface IndiaPeHistoryResponse {
  success: boolean;
  data?: IndiaPeHistoryData;
  error?: string;
}

export const indiaPeHistoryKeys = {
  one: (key: string) => ['market', 'india-pe-history', key] as const,
};

export async function fetchIndiaPeHistory(
  key: string,
  options: { signal?: AbortSignal } = {},
): Promise<IndiaPeHistoryData> {
  const response = await apiFetch<IndiaPeHistoryResponse>(
    `/api/market/india-pe/history?key=${encodeURIComponent(key)}`,
    {
      signal: options.signal,
      timeoutMs: 20_000,
    },
  );

  if (!response.success || !response.data) {
    throw new ApiError(
      response.error ?? 'Monthly index history is unavailable.',
      502,
      'india_pe_history_unavailable',
    );
  }

  return response.data;
}

/**
 * Fetches the cached monthly series only when a chart is visible. The endpoint
 * reads MongoDB, so this does not add any upstream NSE traffic.
 */
export function useIndiaPeHistory(key: string | null, enabled = true) {
  return useQuery({
    queryKey: indiaPeHistoryKeys.one(key ?? ''),
    queryFn: ({ signal }) => fetchIndiaPeHistory(key as string, { signal }),
    enabled: Boolean(key) && enabled,
    staleTime: 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
    retry: 1,
  });
}
