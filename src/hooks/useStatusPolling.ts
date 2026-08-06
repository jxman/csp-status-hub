import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAws } from '../fetchers/awsFetcher';
import { fetchAzure } from '../fetchers/azureFetcher';
import { fetchGcp } from '../fetchers/gcpFetcher';
import { fetchOci } from '../fetchers/ociFetcher';
import { withTimeout } from '../utils/withTimeout';
import type { DashboardStatus, Provider, ProviderStatus } from '../types/status';

const POLL_INTERVAL_MS = 60_000;
const MANUAL_COOLDOWN_MS = 15_000; // shorter than the auto-refresh interval so the button isn't dead for a full minute
const FETCH_TIMEOUT_MS = 12_000; // generous enough for AWS's worst case (up to 3 fetch legs during broad-impact incidents)
const CACHE_KEY = 'csp-status-hub:dashboard';
const CACHE_TTL_MS = 60_000; // 60 seconds — matches poll interval

export const PROVIDER_ORDER: Provider[] = ['aws', 'azure', 'oci', 'gcp'];

const DISPLAY_NAMES: Record<Provider, string> = {
  aws: 'Amazon Web Services',
  azure: 'Microsoft Azure',
  oci: 'Oracle Cloud',
  gcp: 'Google Cloud',
};

const FETCHERS: Record<Provider, () => Promise<ProviderStatus>> = {
  aws: fetchAws,
  azure: fetchAzure,
  oci: fetchOci,
  gcp: fetchGcp,
};

export type ProviderMap = Record<Provider, ProviderStatus | null>;

const EMPTY_PROVIDER_MAP: ProviderMap = { aws: null, azure: null, oci: null, gcp: null };

// --- localStorage cache helpers ---

function loadCache(): ProviderMap | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw) as { data: DashboardStatus; savedAt: number };
    if (Date.now() - savedAt > CACHE_TTL_MS) return null;
    const map: ProviderMap = { ...EMPTY_PROVIDER_MAP };
    for (const p of data.providers) map[p.provider] = p;
    return map;
  } catch {
    return null;
  }
}

function saveCache(providers: ProviderMap) {
  try {
    const data: DashboardStatus = {
      providers: PROVIDER_ORDER.map((id) => providers[id]).filter((p): p is ProviderStatus => p != null),
      lastRefreshedAt: new Date().toISOString(),
    };
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Silently ignore — private browsing or quota exceeded
  }
}

function buildFetchErrorStatus(provider: Provider, reason: unknown): ProviderStatus {
  const err = reason instanceof Error ? reason.message : String(reason);
  return {
    provider,
    displayName: DISPLAY_NAMES[provider],
    overallStatus: 'unknown',
    regions: [],
    activeIncidents: [],
    sourceUrl: '',
    dataFetchedAt: new Date().toISOString(),
    fetchError: err,
  };
}

// --- hook ---

export function useStatusPolling() {
  // Hydrate from cache immediately so the page isn't blank on load
  const [providers, setProviders] = useState<ProviderMap>(() => loadCache() ?? EMPTY_PROVIDER_MAP);
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

    // Each provider updates its own slot the instant its fetch succeeds, instead of
    // waiting for every provider to finish — so a slow or hung provider only holds
    // up its own card, not the rest of the dashboard. FETCH_TIMEOUT_MS bounds how
    // long any one card can stay in "loading" before it's treated as failed.
    // Failures are held back until the whole batch settles (see allFailed below) so
    // a total outage doesn't wipe good cached data with four error cards.
    const results = await Promise.all(
      PROVIDER_ORDER.map((id) =>
        withTimeout(FETCHERS[id](), FETCH_TIMEOUT_MS, DISPLAY_NAMES[id])
          .then((status) => {
            setProviders((prev) => ({ ...prev, [id]: status }));
            return { id, status: 'fulfilled' as const };
          })
          .catch((reason) => ({ id, status: 'rejected' as const, reason }))
      )
    );

    const allFailed = results.every((r) => r.status === 'rejected');

    if (allFailed) {
      // Network down or all providers unreachable — preserve last good data
      // rather than replacing every card with an error state.
      setLastFetchFailed(true);
    } else {
      setProviders((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (r.status === 'rejected') next[r.id] = buildFetchErrorStatus(r.id, r.reason);
        }
        saveCache(next);
        return next;
      });
      setLastFetchFailed(false);
      setLastSuccessfulRefresh(new Date().toISOString());
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
    providers,
    isRefreshing,
    lastSuccessfulRefresh,
    lastFetchFailed,
    isOnline,
    canRefresh,
    cooldownUntil,
    manualRefresh,
  };
}
