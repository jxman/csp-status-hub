import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAws } from '../fetchers/awsFetcher';
import { fetchAzure } from '../fetchers/azureFetcher';
import { fetchGcp } from '../fetchers/gcpFetcher';
import { fetchOci } from '../fetchers/ociFetcher';
import type { DashboardStatus, ProviderStatus } from '../types/status';

const POLL_INTERVAL_MS = 60_000;
const REFRESH_COOLDOWN_MS = 15_000;

function buildDashboardStatus(results: PromiseSettledResult<ProviderStatus>[]): DashboardStatus {
  const providers: ProviderStatus[] = results.map((result, index) => {
    const fallbackProviders = ['aws', 'gcp', 'oci', 'azure'] as const;
    if (result.status === 'fulfilled') {
      return result.value;
    }
    const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return {
      provider: fallbackProviders[index],
      displayName: ['Amazon Web Services', 'Google Cloud', 'Oracle Cloud', 'Microsoft Azure'][index],
      overallStatus: 'unknown',
      regions: [],
      activeIncidents: [],
      sourceUrl: '',
      dataFetchedAt: new Date().toISOString(),
      fetchError: err,
    };
  });

  return {
    providers,
    lastRefreshedAt: new Date().toISOString(),
  };
}

export function useStatusPolling() {
  const [dashboard, setDashboard] = useState<DashboardStatus | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSuccessfulRefresh, setLastSuccessfulRefresh] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    setIsRefreshing(true);
    const results = await Promise.allSettled([
      fetchAws(),
      fetchGcp(),
      fetchOci(),
      fetchAzure(),
    ]);
    const status = buildDashboardStatus(results);
    setDashboard(status);
    setLastSuccessfulRefresh(status.lastRefreshedAt);
    setIsRefreshing(false);
    return status;
  }, []);

  const manualRefresh = useCallback(() => {
    if (Date.now() < cooldownUntil) return;
    setCooldownUntil(Date.now() + REFRESH_COOLDOWN_MS);
    fetchAll();
  }, [cooldownUntil, fetchAll]);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchAll]);

  const canRefresh = Date.now() >= cooldownUntil;

  return {
    dashboard,
    isRefreshing,
    lastSuccessfulRefresh,
    canRefresh,
    cooldownUntil,
    manualRefresh,
  };
}
