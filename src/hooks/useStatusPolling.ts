import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAws } from '../fetchers/awsFetcher';
import { fetchAzure } from '../fetchers/azureFetcher';
import { fetchGcp } from '../fetchers/gcpFetcher';
import { fetchOci } from '../fetchers/ociFetcher';
import type { DashboardStatus, ProviderStatus } from '../types/status';

const POLL_INTERVAL_MS = 60_000;
const MANUAL_COOLDOWN_MS = 60_000; // matches auto-refresh interval
const CACHE_KEY = 'csp-status-hub:dashboard';
const CACHE_TTL_MS = 60_000; // 60 seconds — matches poll interval

// --- localStorage cache helpers ---

function loadCache(): DashboardStatus | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw) as { data: DashboardStatus; savedAt: number };
    if (Date.now() - savedAt > CACHE_TTL_MS) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCache(data: DashboardStatus) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Silently ignore — private browsing or quota exceeded
  }
}

// --- dashboard builder ---

function buildDashboardStatus(results: PromiseSettledResult<ProviderStatus>[]): DashboardStatus {
  const fallbackProviders = ['aws', 'azure', 'oci', 'gcp'] as const;
  const fallbackNames = ['Amazon Web Services', 'Microsoft Azure', 'Oracle Cloud', 'Google Cloud'];

  const providers: ProviderStatus[] = results.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
    return {
      provider: fallbackProviders[index],
      displayName: fallbackNames[index],
      overallStatus: 'unknown',
      regions: [],
      activeIncidents: [],
      sourceUrl: '',
      dataFetchedAt: new Date().toISOString(),
      fetchError: err,
    };
  });

  return { providers, lastRefreshedAt: new Date().toISOString() };
}

// --- hook ---

export function useStatusPolling() {
  // Hydrate from cache immediately so the page isn't blank on load
  const [dashboard, setDashboard] = useState<DashboardStatus | null>(loadCache);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastSuccessfulRefresh, setLastSuccessfulRefresh] = useState<string | null>(null);
  const [lastFetchFailed, setLastFetchFailed] = useState(false);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [cooldownUntil, setCooldownUntil] = useState<number>(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOnlineRef = useRef(isOnline);
  isOnlineRef.current = isOnline;

  // --- network listeners ---
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // --- fetch logic ---
  const fetchAll = useCallback(async () => {
    setIsRefreshing(true);

    const results = await Promise.allSettled([
      fetchAws(),
      fetchAzure(),
      fetchOci(),
      fetchGcp(),
    ]);

    const allFailed = results.every((r) => r.status === 'rejected');

    if (allFailed) {
      // Network is down or all providers unreachable — preserve last good data
      setLastFetchFailed(true);
    } else {
      const status = buildDashboardStatus(results);
      setDashboard(status);
      setLastSuccessfulRefresh(status.lastRefreshedAt);
      saveCache(status);
      setLastFetchFailed(false);
    }

    setIsRefreshing(false);
    // Cooldown starts only AFTER the fetch completes
    setCooldownUntil(Date.now() + MANUAL_COOLDOWN_MS);
  }, []);

  // --- auto-refresh: pause when offline, resume when back online ---
  useEffect(() => {
    const start = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (isOnlineRef.current) fetchAll();
      }, POLL_INTERVAL_MS);
    };

    if (isOnline) {
      fetchAll(); // immediate fetch on mount or when coming back online
      start();
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  // --- manual refresh ---
  const manualRefresh = useCallback(() => {
    if (isRefreshing || Date.now() < cooldownUntil || !isOnline) return;
    fetchAll();
  }, [isRefreshing, cooldownUntil, isOnline, fetchAll]);

  const canRefresh = !isRefreshing && Date.now() >= cooldownUntil && isOnline;

  return {
    dashboard,
    isRefreshing,
    lastSuccessfulRefresh,
    lastFetchFailed,
    isOnline,
    canRefresh,
    cooldownUntil,
    manualRefresh,
  };
}
