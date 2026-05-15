import { useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { useStatusPolling } from './hooks/useStatusPolling';
import { useTheme } from './hooks/useTheme';
import { StatusHeader } from './components/StatusHeader';
import { ProviderGrid } from './components/ProviderGrid';
import { IncidentList } from './components/IncidentList';
import { formatRelative } from './utils/formatters';
import type { ProviderStatus } from './types/status';

function ComingSoonModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 14, padding: '32px 36px', maxWidth: 400, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 32, lineHeight: 1 }}>🔔</div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
            Alerts coming soon
          </div>
          <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            We're working on email and webhook alerts so you can get notified the moment a provider reports an incident. Stay tuned — this feature is on its way.
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-end', marginTop: 4,
            padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border-strong)',
            background: 'var(--ink)', color: 'var(--bg)',
            fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
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
  const affectedRegions = live.reduce(
    (acc, p) => acc + p.regions.filter((r) => r.overallStatus !== 'operational').length, 0
  );
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
          <span className={`num${affectedRegions > 0 ? ' red' : ''}`}>{affectedRegions}</span>
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

  const { theme, toggle } = useTheme();
  const [showAlertsModal, setShowAlertsModal] = useState(false);

  const hasDegradedProvider = dashboard?.providers.some(
    (p) => p.overallStatus === 'degraded' || p.overallStatus === 'outage'
  ) ?? false;

  return (
    <div className="dash">
      <Analytics />
      <SpeedInsights />
      {showAlertsModal && <ComingSoonModal onClose={() => setShowAlertsModal(false)} />}

      <StatusHeader
        lastRefreshedAt={lastSuccessfulRefresh}
        onRefresh={manualRefresh}
        isRefreshing={isRefreshing}
        canRefresh={canRefresh}
        cooldownUntil={cooldownUntil}
        isOnline={isOnline}
        hasDegradedProvider={hasDegradedProvider}
        theme={theme}
        onToggleTheme={toggle}
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
          </footer>
        </>
      )}

    </div>
  );
}
