import { useQuery } from '@tanstack/react-query';

import { ApiError, apiFetch } from '@/src/lib/api/client';

export type CrossCheckStatus = 'match' | 'mismatch' | 'stale' | 'unavailable';

export interface GoldSilverQuote {
  goldUsd: number | null;
  silverUsd: number | null;
  ratio: number | null;
  asOf: string | null;
  stale: boolean;
}

export interface GoldSilverData {
  ratio: number | null;
  goldUsd: number | null;
  silverUsd: number | null;
  primarySource: 'yahoo' | 'xaus' | null;
  asOf: string | null;
  stale: boolean;
  yahoo: GoldSilverQuote | null;
  xaus: GoldSilverQuote | null;
  crossCheck: {
    status: CrossCheckStatus;
    differencePct: number | null;
    tolerancePct: number;
  };
}

interface GoldSilverResponse {
  success: boolean;
  data?: GoldSilverData;
  error?: string;
}

export const goldSilverKeys = {
  all: ['market', 'gold-silver'] as const,
};

export async function fetchGoldSilver(
  options: { signal?: AbortSignal } = {},
): Promise<GoldSilverData> {
  const response = await apiFetch<GoldSilverResponse>('/api/market/gold-silver', {
    signal: options.signal,
    timeoutMs: 20_000,
  });

  if (!response.success || !response.data) {
    throw new ApiError(
      response.error ?? 'Gold and silver quotes are unavailable.',
      502,
      'gold_silver_unavailable',
    );
  }

  return response.data;
}

/**
 * Gold/silver ratio with an independent xaus.com cross-check. The endpoint
 * caches upstream calls for ten minutes, so poll less often than portfolio data.
 */
export function useGoldSilverRatio() {
  return useQuery({
    queryKey: goldSilverKeys.all,
    queryFn: ({ signal }) => fetchGoldSilver({ signal }),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 1,
  });
}
