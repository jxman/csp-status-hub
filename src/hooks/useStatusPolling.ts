import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAws } from '../fetchers/awsFetcher';
import { fetchAzure } from '../fetchers/azureFetcher';
import { fetchGcp } from '../fetchers/gcpFetcher';
import { fetchOci } from '../fetchers/ociFetcher';
import type { DashboardStatus, ProviderStatus } from '../types/status';

const POLL_INTERVAL_MS = 60_000;
const MANUAL_COOLDOWN_MS = 15_000; // shorter than the auto-refresh interval so the button isn't dead for a full minute
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
  const [isVisible, setIsVisible] = useState(() => document.visibilityState === 'visible');
  const [cooldownUntil, setCooldownUntil] = useState<number>(0); // drives the header's "Auto-refresh in Xs" countdown
  const [manualCooldownUntil, setManualCooldownUntil] = useState<number>(0);
  const [canManualRefresh, setCanManualRefresh] = useState(true); // re-render trigger — manualCooldownUntil alone won't re-render once elapsed

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isOnlineRef = useRef(isOnline);
  const isVisibleRef = useRef(isVisible);
  isOnlineRef.current = isOnline;
  isVisibleRef.current = isVisible;

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

  // --- page visibility listeners ---
  useEffect(() => {
    const handleVisibilityChange = () => setIsVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  // --- manual refresh cooldown: a plain "Date.now() >= manualCooldownUntil" check
  // never re-renders on its own once time passes, so the button would stay visibly
  // disabled until some unrelated state change happened to re-render this hook's
  // owner. This timeout forces a re-render right when the cooldown actually ends.
  useEffect(() => {
    if (manualCooldownUntil <= Date.now()) {
      setCanManualRefresh(true);
      return;
    }
    setCanManualRefresh(false);
    const timeout = setTimeout(() => setCanManualRefresh(true), manualCooldownUntil - Date.now());
    return () => clearTimeout(timeout);
  }, [manualCooldownUntil]);

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
    // Cooldowns start only AFTER the fetch completes
    const now = Date.now();
    setCooldownUntil(now + POLL_INTERVAL_MS);
    setManualCooldownUntil(now + MANUAL_COOLDOWN_MS);
  }, []);

  // --- auto-refresh: pause when offline or tab hidden, resume when both restored ---
  useEffect(() => {
    const start = () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (isOnlineRef.current && isVisibleRef.current) fetchAll();
      }, POLL_INTERVAL_MS);
    };

    if (isOnline && isVisible) {
      fetchAll(); // immediate fetch on mount, reconnect, or tab focus
      start();
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline, isVisible]);

  // --- manual refresh ---
  const manualRefresh = useCallback(() => {
    if (isRefreshing || Date.now() < manualCooldownUntil || !isOnline) return;
    fetchAll();
  }, [isRefreshing, manualCooldownUntil, isOnline, fetchAll]);

  const canRefresh = !isRefreshing && canManualRefresh && isOnline;

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
