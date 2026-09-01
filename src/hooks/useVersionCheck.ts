import { useEffect, useState } from 'react';

// Detects when a newer build has been deployed while this tab is still open.
// This is a static SPA with no service worker — the 60s status-polling cycle
// only re-fetches provider JSON and re-renders with whatever JS bundle is
// already loaded in memory, so a long-lived tab can keep running stale
// fetch/parse logic indefinitely even though it's genuinely refreshing data
// (found 2026-09-01: a GCP fetcher fix landed, but an already-open tab kept
// showing the old extraction behavior until reloaded). vite.config.ts emits
// dist/version.json with the same buildDate baked into this bundle as
// __BUILD_DATE__, so comparing the two detects a stale tab.
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function useVersionCheck(): boolean {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { buildDate?: string };
        if (!cancelled && data.buildDate && data.buildDate !== __BUILD_DATE__) {
          setUpdateAvailable(true);
          clearInterval(id);
        }
      } catch {
        // Network hiccup — ignore, next interval (or visibility) retries.
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') check();
    }

    const id = setInterval(check, CHECK_INTERVAL_MS);
    check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return updateAvailable;
}
