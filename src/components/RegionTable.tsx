import { useState } from 'react';
import type { ProviderStatus, ServiceStatus, StatusLevel } from '../types/status';
import { StatusBadge } from './StatusBadge';
import { AWS_CRITICAL_SERVICE_IDS, AWS_SERVICE_NAMES } from '../utils/awsServices';
import { GCP_CRITICAL_SERVICES } from '../utils/gcpServices';
import { OCI_CRITICAL_SERVICES } from '../utils/ociServices';

interface Props {
  provider: ProviderStatus;
}

const MULTIPLE_SERVICES_ID = 'multipleservices';

const STATUS_PAGE_INFO: Partial<Record<ProviderStatus['provider'], { url: string; label: string }>> = {
  aws: { url: 'https://status.aws.amazon.com/', label: 'AWS status page' },
  gcp: { url: 'https://status.cloud.google.com/', label: 'GCP status page' },
  oci: { url: 'https://ocistatus.oraclecloud.com/', label: 'OCI status page' },
};

function worstOf(statuses: StatusLevel[]): StatusLevel {
  if (statuses.includes('outage')) return 'outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('unknown')) return 'unknown';
  return 'operational';
}

function svcStatusClass(status: StatusLevel): string {
  if (status === 'operational') return 'ok';
  if (status === 'degraded') return 'warn';
  return 'bad';
}

function svcStatusLabel(status: StatusLevel): string {
  if (status === 'operational') return 'Operational';
  if (status === 'degraded') return 'Degraded';
  return 'Outage';
}

function buildServiceList(
  feedServices: ServiceStatus[],
  criticalIds: string[],
  nameMap: Record<string, string>
): ServiceStatus[] {
  const feedMap = new Map(feedServices.map((s) => [s.serviceId, s]));
  const critical: ServiceStatus[] = criticalIds.map((id) =>
    feedMap.get(id) ?? { serviceId: id, serviceName: nameMap[id] ?? id, status: 'operational', incidents: [] }
  );
  const criticalSet = new Set(criticalIds);
  const others = feedServices.filter((s) => !criticalSet.has(s.serviceId) && s.serviceId !== MULTIPLE_SERVICES_ID);
  const multipleEntry = feedServices.find((s) => s.serviceId === MULTIPLE_SERVICES_ID);
  const multipleRow: ServiceStatus[] = multipleEntry
    ? [{ serviceId: MULTIPLE_SERVICES_ID, serviceName: 'Multiple Services *', status: multipleEntry.status, incidents: multipleEntry.incidents }]
    : [];
  return [...critical, ...others, ...multipleRow];
}

// Canonical services are matched by GCP's stable productId first (verified against
// status.cloud.google.com/products.json); title keyword is a fallback only, in case
// GCP ever changes a productId. Always shows the same top-10 list; any additional
// impacted product collapses into a single "Multiple Services *" row, matching AWS.
function buildGcpServiceList(feedServices: ServiceStatus[]): ServiceStatus[] {
  const matchedIds = new Set<string>();
  const critical: ServiceStatus[] = GCP_CRITICAL_SERVICES.map((def) => {
    const match = feedServices.find((s) =>
      s.serviceId === def.productId || def.keywords.some((kw) => s.serviceName.toLowerCase().includes(kw))
    );
    if (match) matchedIds.add(match.serviceId);
    return match
      ? { serviceId: def.id, serviceName: def.name, status: match.status, incidents: match.incidents }
      : { serviceId: def.id, serviceName: def.name, status: 'operational' as StatusLevel, incidents: [] };
  });

  const extras = feedServices.filter((s) => !matchedIds.has(s.serviceId));
  const multipleRow: ServiceStatus[] = extras.length > 0
    ? [{
        serviceId: MULTIPLE_SERVICES_ID,
        serviceName: 'Multiple Services *',
        status: worstOf(extras.map((s) => s.status)),
        incidents: extras.flatMap((s) => s.incidents),
      }]
    : [];

  return [...critical, ...multipleRow];
}

// OCI's incident-summary.rss gives free-text service names/categories (e.g.
// "Networking", "Virtual Cloud Network (VCN)"), not a clean enum like AWS's slugs —
// matched by keyword only (no stable per-product id like GCP's productId). Same
// always-show-top-10 + "Multiple Services *" catch-all pattern as AWS/GCP.
function buildOciServiceList(feedServices: ServiceStatus[]): ServiceStatus[] {
  const matchedIds = new Set<string>();
  const critical: ServiceStatus[] = OCI_CRITICAL_SERVICES.map((def) => {
    const match = feedServices.find((s) =>
      s.serviceId !== MULTIPLE_SERVICES_ID && def.keywords.some((kw) => s.serviceName.toLowerCase().includes(kw))
    );
    if (match) matchedIds.add(match.serviceId);
    return match
      ? { serviceId: def.id, serviceName: def.name, status: match.status, incidents: match.incidents }
      : { serviceId: def.id, serviceName: def.name, status: 'operational' as StatusLevel, incidents: [] };
  });

  const extras = feedServices.filter((s) => !matchedIds.has(s.serviceId));
  const multipleRow: ServiceStatus[] = extras.length > 0
    ? [{
        serviceId: MULTIPLE_SERVICES_ID,
        serviceName: 'Multiple Services *',
        status: worstOf(extras.map((s) => s.status)),
        incidents: extras.flatMap((s) => s.incidents),
      }]
    : [];

  return [...critical, ...multipleRow];
}

interface RegionRowProps {
  regionId: string;
  regionName: string;
  geographicArea: string;
  overallStatus: StatusLevel;
  services: ServiceStatus[];
  provider: ProviderStatus['provider'];
}

const ChevronDown = ({ open }: { open: boolean }) => (
  <svg
    className={`region-chevron${open ? ' open' : ''}`}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="M19 9l-7 7-7-7" />
  </svg>
);

function RegionRow({ regionName, overallStatus, services, provider }: RegionRowProps) {
  const [open, setOpen] = useState(false);

  let displayServices: ServiceStatus[];
  if (provider === 'aws') {
    displayServices = buildServiceList(services, AWS_CRITICAL_SERVICE_IDS, AWS_SERVICE_NAMES);
  } else if (provider === 'gcp') {
    displayServices = buildGcpServiceList(services);
  } else if (provider === 'oci') {
    displayServices = buildOciServiceList(services);
  } else {
    displayServices = services;
  }

  return (
    <div className="region-block">
      <div className="region-head" onClick={() => setOpen((o) => !o)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}>
        <div className="region-name">
          <span className="region-label">{regionName}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={overallStatus} />
          <ChevronDown open={open} />
        </div>
      </div>

      {open && (
        <div className="svc-list">
          {displayServices.length === 0 ? (
            <div className="svc" style={{ gridColumn: '1/-1', fontStyle: 'italic', color: 'var(--ink-4)' }}>
              No service detail available.
            </div>
          ) : (
            displayServices.map((svc) => (
              <>
                <div key={`${svc.serviceId}-n`} className="svc"
                  style={svc.serviceId === MULTIPLE_SERVICES_ID ? { fontWeight: 600 } : undefined}>
                  {svc.serviceName}
                </div>
                <div key={`${svc.serviceId}-s`} className={`status ${svcStatusClass(svc.status)}`}>
                  <span className="d" />{svcStatusLabel(svc.status)}
                </div>
              </>
            ))
          )}
          {displayServices.some((s) => s.serviceId === MULTIPLE_SERVICES_ID) && STATUS_PAGE_INFO[provider] && (
            <p style={{ gridColumn: '1/-1', fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', margin: '4px 0 0' }}>
              * See{' '}
              <a href={STATUS_PAGE_INFO[provider]!.url} target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--blue)' }}>
                {STATUS_PAGE_INFO[provider]!.label}
              </a>{' '}
              for full listing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function RegionTable({ provider }: Props) {
  return (
    <>
      {provider.regions.map((region) => (
        <RegionRow
          key={region.regionId}
          regionId={region.regionId}
          regionName={region.regionName}
          geographicArea={region.geographicArea}
          overallStatus={region.overallStatus}
          services={region.services}
          provider={provider.provider}
        />
      ))}
    </>
  );
}
