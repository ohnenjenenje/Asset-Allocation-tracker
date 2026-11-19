import { useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch } from '@/src/lib/api/client';

export type IndiaIndexKey = 'nifty50' | 'niftyBank' | 'niftyIt' | 'niftyMidcap100';

export interface IndiaIndexHistory {
  sampleMonths: number;
  medianPe: number | null;
  /** Share of the window with a lower P/E; 0 is cheapest. */
  percentile: number | null;
  start: string | null;
  end: string | null;
}

export interface IndiaIndexValuation {
  key: IndiaIndexKey;
  name: string;
  pe: number | null;
  pb: number | null;
  dividendYield: number | null;
  earningsYield: number | null;
  history: IndiaIndexHistory | null;
}

export interface IndiaPeData {
  asOf: string | null;
  source: 'nse' | 'downstox' | 'mixed' | null;
  stale: boolean;
  indices: IndiaIndexValuation[];
}

interface IndiaPeResponse {
  success: boolean;
  data?: IndiaPeData;
  error?: string;
}

export const indiaPeKeys = {
  all: ['market', 'india-pe'] as const,
};

export async function fetchIndiaPe(
  options: { signal?: AbortSignal } = {},
): Promise<IndiaPeData> {
  const response = await apiFetch<IndiaPeResponse>('/api/market/india-pe', {
    signal: options.signal,
    timeoutMs: 20_000,
  });

  if (!response.success || !response.data) {
    throw new ApiError(
      response.error ?? 'Indian index valuations are unavailable.',
      502,
      'india_pe_unavailable',
    );
  }

  return response.data;
}

/**
 * End-of-day NSE valuations with a five-year monthly history. The index file
 * updates once per trading day, so there is no value in polling aggressively.
 */
export function useIndiaPe() {
  return useQuery({
    queryKey: indiaPeKeys.all,
    queryFn: ({ signal }) => fetchIndiaPe({ signal }),
    staleTime: 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
    refetchInterval: 6 * 60 * 60_000,
    retry: 1,
  });
}
