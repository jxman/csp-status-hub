import { useState } from 'react';
import type { Incident, ProviderStatus, StatusLevel } from '../types/status';
import { RegionTable } from './RegionTable';
import { IncidentTable } from './IncidentTable';
import { FlatServiceList, type FlatService } from './FlatServiceList';
import { ErrorState } from './ErrorState';
import { StatusBadge } from './StatusBadge';
import { OCI_CRITICAL_SERVICES } from '../utils/ociServices';
import { GCP_CRITICAL_SERVICES } from '../utils/gcpServices';
import { AZURE_CRITICAL_SERVICES } from '../utils/azureServices';
import { AWS_CRITICAL_SERVICE_IDS, AWS_SERVICE_NAMES } from '../utils/awsServices';

interface Props {
  provider: ProviderStatus;
}

const SHORT_NAMES: Record<string, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP', oci: 'OCI' };

const OFFICIAL_URLS: Record<string, string> = {
  aws:   'https://status.aws.amazon.com/',
  azure: 'https://azure.status.microsoft/',
  gcp:   'https://status.cloud.google.com/',
  oci:   'https://ocistatus.oraclecloud.com/',
};

function computeAzureServiceStatuses(incidents: Incident[]): FlatService[] {
  const active = incidents.filter((inc) => inc.status !== 'resolved');
  return AZURE_CRITICAL_SERVICES.map((svc) => {
    const affecting = active.filter((inc) =>
      inc.affectedServices.some((s) =>
        svc.keywords.some((kw) => s.toLowerCase().includes(kw))
      )
    );
    let status: StatusLevel = 'operational';
    if (affecting.length > 0) {
      status = affecting.some((inc) => inc.severity === 'high') ? 'outage' : 'degraded';
    }
    return { id: svc.id, name: svc.name, status };
  });
}

function awsFlatServices(): FlatService[] {
  return AWS_CRITICAL_SERVICE_IDS.map((id) => ({
    id,
    name: AWS_SERVICE_NAMES[id] ?? id,
    status: 'operational' as StatusLevel,
  }));
}

function getSubtext(provider: ProviderStatus): string {
  if (provider.fetchError && provider.regions.length === 0 && provider.activeIncidents.length === 0) return '';
  const isImpacted = provider.overallStatus === 'outage' || provider.overallStatus === 'degraded';
  if (isImpacted) {
    const affectedRegions = provider.regions.filter((r) => r.overallStatus !== 'operational').length;
    if (affectedRegions > 0) return `${affectedRegions} region${affectedRegions !== 1 ? 's' : ''} affected`;
    const activeInc = provider.activeIncidents.filter((i) => i.status !== 'resolved').length;
    if (activeInc > 0) return `${activeInc} active incident${activeInc !== 1 ? 's' : ''}`;
    return 'Impact details unavailable';
  }
  return 'All regions healthy';
}

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    style={{ color: 'var(--ink-4)', flexShrink: 0, transition: 'transform 0.15s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
  >
    <path d="M19 9l-7 7-7-7" />
  </svg>
);

export function ProviderPanel({ provider }: Props) {
  const hasRegions = provider.regions.length > 0;
  const hasActiveIncidents = provider.activeIncidents.filter((i) => i.status !== 'resolved').length > 0;
  // Cards with regions or active incidents are always expanded (rows collapse individually).
  // Flat-service cards (healthy providers) are collapsible at the card level.
  const isExpandable = !hasRegions && !hasActiveIncidents;
  const [expanded, setExpanded] = useState(false);

  if (provider.fetchError && provider.regions.length === 0 && provider.activeIncidents.length === 0 && !provider.coverageNote) {
    return <ErrorState provider={provider.provider} error={provider.fetchError} sourceUrl={provider.sourceUrl} />;
  }

  const isImpacted = provider.overallStatus === 'outage' || provider.overallStatus === 'degraded';
  const incidentCount = provider.activeIncidents.filter((inc) => inc.status !== 'resolved').length;
  const officialUrl = provider.sourceUrl || OFFICIAL_URLS[provider.provider] || '#';
  const showBody = !isExpandable || expanded;

  const flatServices = (): FlatService[] => {
    if (provider.provider === 'azure') return computeAzureServiceStatuses(provider.activeIncidents);
    if (provider.provider === 'oci')   return OCI_CRITICAL_SERVICES;
    if (provider.provider === 'gcp')   return GCP_CRITICAL_SERVICES;
    return awsFlatServices();
  };

  return (
    <div className={`pcard${isImpacted ? ' bad' : ''}`}>
      {/* Header — clickable to expand/collapse for flat-service cards */}
      <div
        className="pcard-head"
        onClick={isExpandable ? () => setExpanded((e) => !e) : undefined}
        style={isExpandable ? { cursor: 'pointer', userSelect: 'none' } : undefined}
      >
        <div className="pcard-titlerow">
          <div className="pcard-name">
            <span className="short">{SHORT_NAMES[provider.provider] ?? provider.provider.toUpperCase()}</span>
            <span className="long">{provider.displayName}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <StatusBadge status={provider.overallStatus} />
            {isExpandable && <ChevronIcon open={expanded} />}
          </div>
        </div>
        <div className="pcard-sub">{getSubtext(provider)}</div>
      </div>

      {/* Body */}
      {showBody && (
        <div className="pcard-body">
          {provider.coverageNote && (
            <div style={{
              margin: '8px 16px 0', padding: '8px 10px', borderRadius: 6,
              background: 'color-mix(in oklab, var(--blue) 8%, transparent)',
              border: '1px solid color-mix(in oklab, var(--blue) 20%, transparent)',
              fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5,
            }}>
              {provider.coverageNote}
            </div>
          )}
          {provider.fetchError && (
            <div style={{
              margin: '8px 16px 0', padding: '8px 10px', borderRadius: 6,
              background: 'var(--amber-soft)',
              border: '1px solid color-mix(in oklab, var(--amber) 30%, transparent)',
              fontSize: 12, color: 'var(--ink-2)',
            }}>
              {provider.fetchError}
            </div>
          )}

          {hasRegions ? (
            <RegionTable provider={provider} />
          ) : hasActiveIncidents ? (
            <IncidentTable incidents={provider.activeIncidents} />
          ) : (
            <div style={{ padding: '8px 16px' }}>
              <FlatServiceList services={flatServices()} status={provider.overallStatus} />
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="pcard-foot">
        <span>
          {incidentCount > 0
            ? `${incidentCount} active incident${incidentCount !== 1 ? 's' : ''}`
            : 'No active incidents'}
        </span>
        <a href={officialUrl} target="_blank" rel="noopener noreferrer">
          Official status page →
        </a>
      </div>
    </div>
  );
}
