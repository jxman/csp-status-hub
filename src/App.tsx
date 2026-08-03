import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { useStatusPolling } from './hooks/useStatusPolling';
import { useTheme } from './hooks/useTheme';
import { StatusHeader } from './components/StatusHeader';
import { ProviderGrid } from './components/ProviderGrid';
import { IncidentList } from './components/IncidentList';
import { SubscribeModal } from './components/SubscribeModal';
import { AboutModal } from './components/AboutModal';
import { formatRelative } from './utils/formatters';
import type { ProviderStatus } from './types/status';

type UrlBanner =
  | { kind: 'ok'; text: string }
  | { kind: 'error'; text: string };

const URL_BANNERS: Record<string, UrlBanner> = {
  'confirm=success': { kind: 'ok', text: "You're subscribed! You'll get an email when a provider you follow reports a new outage." },
  'confirm=updated': { kind: 'ok', text: 'Your alert preferences have been updated.' },
  'confirm=error': { kind: 'error', text: 'That confirmation link is invalid or has expired. Try subscribing again.' },
  'unsubscribed=1': { kind: 'ok', text: "You've been unsubscribed from Cloud Status Hub alerts." },
  'unsubscribed=error': { kind: 'error', text: 'That unsubscribe link is invalid.' },
};

function useUrlBanner() {
  const [banner, setBanner] = useState<UrlBanner | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    for (const [key, value] of Object.entries(URL_BANNERS)) {
      const [param, expected] = key.split('=');
      if (params.get(param) === expected) {
        setBanner(value);
        params.delete(param);
        const next = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : ''));
        break;
      }
    }
  }, []);

  return [banner, () => setBanner(null)] as const;
}

function computeImpactedServices(providers: ProviderStatus[]): { count: number; isApproximate: boolean } {
  const live = providers.filter((p) => !p.fetchError);
  const uniqueKeys = new Set<string>();
  let isApproximate = false;

  for (const p of live) {
    if (p.overallStatus === 'operational') continue;
    if (p.regions.length > 0) {
      for (const region of p.regions) {
        for (const svc of region.services) {
          if (svc.status !== 'operational') {
            if (svc.serviceId === 'multipleservices' || svc.serviceId === 'unknown') {
              isApproximate = true;
            } else {
              uniqueKeys.add(`${p.provider}:${region.regionId}:${svc.serviceId}`);
            }
          }
        }
      }
    } else {
      for (const inc of p.activeIncidents.filter((i) => i.status !== 'resolved')) {
        for (const svc of inc.affectedServices) {
          if (svc === 'multipleservices' || svc === 'unknown') {
            isApproximate = true;
          } else if (svc) {
            uniqueKeys.add(`${p.provider}:${svc}`);
          }
        }
      }
    }
  }

  return { count: uniqueKeys.size, isApproximate };
}

function StatsBanner({ providers }: { providers: ProviderStatus[] }) {
  const live = providers.filter((p) => !p.fetchError);
  const degradedProviders = live.filter(
    (p) => p.overallStatus === 'degraded' || p.overallStatus === 'outage'
  ).length;
  const impactedRegionsList = live.flatMap((p) => p.regions.filter((r) => r.overallStatus !== 'operational'));
  const affectedRegions = impactedRegionsList.length;
  // A "global" region isn't literally one region — it's an edge/global-scoped
  // service (e.g. AWS CloudFront, Route 53) whose true blast radius spans every
  // region, so the discrete count understates impact. Flag it the same way
  // computeImpactedServices flags 'multipleservices'/'unknown' below.
  const hasGlobalRegion = impactedRegionsList.some((r) => r.regionId === 'global');
  const activeIncidents = live.reduce(
    (acc, p) => acc + p.activeIncidents.filter((i) => i.status !== 'resolved').length, 0
  );
  const { count: impactedServices, isApproximate } = computeImpactedServices(providers);
  const hasIssues = degradedProviders > 0;

  return (
    <div className={`a-summary${hasIssues ? '' : ' all-clear'}`}>
      <div className="stat">
        <span>
          <span className={`num${degradedProviders > 0 ? ' red' : ''}`}>{degradedProviders}</span>
          <br /><b>provider{degradedProviders !== 1 ? 's' : ''} degraded</b>
        </span>
        <span>
          <span className={`num${affectedRegions > 0 ? ' red' : ''}`}>
            {affectedRegions}{hasGlobalRegion ? '+' : ''}
          </span>
          <br /><b>region{affectedRegions !== 1 ? 's' : ''} impacted</b>
        </span>
        <span>
          <span className={`num${impactedServices > 0 ? ' red' : ''}`}>
            {impactedServices}{isApproximate ? '+' : ''}
          </span>
          <br /><b>service{impactedServices !== 1 ? 's' : ''} impacted</b>
        </span>
        <span>
          <span className="num">{activeIncidents}</span>
          <br /><b>active incident{activeIncidents !== 1 ? 's' : ''}</b>
        </span>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="a-grid" style={{ paddingTop: 20 }}>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="pcard" style={{ padding: 16, minHeight: 120 }}>
          <div style={{ height: 16, width: '60%', background: 'var(--border)', borderRadius: 4, marginBottom: 10, animation: 'pulse-skeleton 1.4s ease-in-out infinite' }} />
          <div style={{ height: 12, width: '40%', background: 'var(--border)', borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const {
    dashboard,
    isRefreshing,
    lastSuccessfulRefresh,
    lastFetchFailed,
    isOnline,
    canRefresh,
    cooldownUntil,
    manualRefresh,
  } = useStatusPolling();

  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [urlBanner, dismissUrlBanner] = useUrlBanner();

  const hasDegradedProvider = dashboard?.providers.some(
    (p) => p.overallStatus === 'degraded' || p.overallStatus === 'outage'
  ) ?? false;

  return (
    <div className="dash">
      <Analytics />
      <SpeedInsights />
      {showAlertsModal && <SubscribeModal onClose={() => setShowAlertsModal(false)} />}
      {showAboutModal && <AboutModal onClose={() => setShowAboutModal(false)} />}

      {urlBanner && (
        <div style={{
          padding: '10px 32px',
          background: urlBanner.kind === 'ok' ? 'var(--green-soft)' : 'var(--red-soft)',
          color: urlBanner.kind === 'ok' ? 'var(--green-text)' : 'var(--red-text)',
          fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <span>{urlBanner.text}</span>
          <button
            onClick={dismissUrlBanner}
            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 0 }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      <StatusHeader
        lastRefreshedAt={lastSuccessfulRefresh}
        onRefresh={manualRefresh}
        isRefreshing={isRefreshing}
        canRefresh={canRefresh}
        cooldownUntil={cooldownUntil}
        isOnline={isOnline}
        hasDegradedProvider={hasDegradedProvider}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
        onShowAbout={() => setShowAboutModal(true)}
        onSubscribe={() => setShowAlertsModal(true)}
      />

      {/* Offline banner */}
      {!isOnline && (
        <div style={{
          margin: '0', padding: '12px 32px',
          background: 'var(--red-soft)', borderBottom: '1px solid color-mix(in oklab, var(--red) 20%, transparent)',
          color: 'var(--red-text)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red)', display: 'inline-block', flexShrink: 0 }} />
          No network connection — auto-refresh paused
          {lastSuccessfulRefresh && `, showing data from ${formatRelative(lastSuccessfulRefresh)}`}
        </div>
      )}

      {/* Stale data banner */}
      {isOnline && lastFetchFailed && dashboard && (
        <div style={{
          padding: '10px 32px',
          background: 'var(--amber-soft)', borderBottom: '1px solid color-mix(in oklab, var(--amber) 25%, transparent)',
          color: 'oklch(0.42 0.12 75)', fontSize: 13,
        }}>
          Last refresh failed — showing data from {lastSuccessfulRefresh ? formatRelative(lastSuccessfulRefresh) : 'a previous session'}. Will retry automatically.
        </div>
      )}

      {!dashboard ? (
        <LoadingSkeleton />
      ) : (
        <>
          <StatsBanner providers={dashboard.providers} />
          <ProviderGrid providers={dashboard.providers} />
          <IncidentList providers={dashboard.providers} />
          <footer style={{
            padding: '16px 32px 24px', fontSize: 11,
            color: 'var(--ink-4)', borderTop: '1px solid var(--border)',
            fontFamily: "'Geist Mono', monospace", letterSpacing: '0.03em',
            textAlign: 'center',
          }}>
            <span className="footer-full">Data sourced from official public status pages · Refreshes every 60s · Times in local timezone · Not affiliated with AWS, Azure, GCP, or Oracle</span>
            <span className="footer-short">Public status data · 60s refresh · Local time · No vendor affiliation</span>
            <p className="footer-about">
              <span className="footer-full">
                Built by John Xanthopoulos (Synepho) to check AWS, Azure, GCP, and Oracle Cloud status in one place instead of four browser tabs.
              </span>
              <span className="footer-short">Built by John Xanthopoulos (Synepho).</span>
            </p>
          </footer>
        </>
      )}

    </div>
  );
}
