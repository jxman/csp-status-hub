import { useState } from 'react';
import type { ProviderStatus, ServiceStatus, StatusLevel } from '../types/status';
import { StatusBadge } from './StatusBadge';
import { AWS_CRITICAL_SERVICE_IDS, AWS_SERVICE_NAMES } from '../utils/awsServices';
import { GCP_CRITICAL_SERVICE_IDS, GCP_SERVICE_NAMES } from '../utils/gcpServices';

interface Props {
  provider: ProviderStatus;
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
  const others = feedServices.filter((s) => !criticalSet.has(s.serviceId) && s.serviceId !== 'multipleservices');
  const multipleEntry = feedServices.find((s) => s.serviceId === 'multipleservices');
  const multipleRow: ServiceStatus[] = multipleEntry
    ? [{ serviceId: 'multipleservices', serviceName: 'Multiple Services *', status: multipleEntry.status, incidents: multipleEntry.incidents }]
    : [];
  return [...critical, ...others, ...multipleRow];
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
    displayServices = buildServiceList(services, GCP_CRITICAL_SERVICE_IDS, GCP_SERVICE_NAMES);
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
                  style={svc.serviceId === 'multipleservices' ? { fontWeight: 600 } : undefined}>
                  {svc.serviceName}
                </div>
                <div key={`${svc.serviceId}-s`} className={`status ${svcStatusClass(svc.status)}`}>
                  <span className="d" />{svcStatusLabel(svc.status)}
                </div>
              </>
            ))
          )}
          {displayServices.some((s) => s.serviceId === 'multipleservices') && (
            <p style={{ gridColumn: '1/-1', fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', margin: '4px 0 0' }}>
              * See{' '}
              <a href="https://status.aws.amazon.com/" target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--blue)' }}>
                AWS status page
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
