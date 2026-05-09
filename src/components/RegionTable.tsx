import { useState } from 'react';
import type { ProviderStatus, ServiceStatus, StatusLevel } from '../types/status';
import { statusColor, statusLabel, statusTextColor } from '../utils/statusHelpers';
import { AWS_CRITICAL_SERVICE_IDS, AWS_SERVICE_NAMES } from '../utils/awsServices';
import { GCP_CRITICAL_SERVICE_IDS, GCP_SERVICE_NAMES } from '../utils/gcpServices';

interface Props {
  provider: ProviderStatus;
}

function ServiceLine({ service }: { service: ServiceStatus }) {
  return (
    <div className="flex items-center justify-between py-1 px-3">
      <span className="text-xs text-gray-600 dark:text-gray-400">{service.serviceName}</span>
      <span className={`text-xs font-medium ${statusTextColor(service.status)}`}>
        {statusLabel(service.status)}
      </span>
    </div>
  );
}

function buildServiceList(
  feedServices: ServiceStatus[],
  criticalIds: string[],
  nameMap: Record<string, string>
): ServiceStatus[] {
  const feedMap = new Map(feedServices.map((s) => [s.serviceId, s]));

  const critical: ServiceStatus[] = criticalIds.map((id) =>
    feedMap.get(id) ?? {
      serviceId: id,
      serviceName: nameMap[id] ?? id,
      status: 'operational' as StatusLevel,
      incidents: [],
    }
  );

  const criticalSet = new Set(criticalIds);
  const others = feedServices.filter((s) => !criticalSet.has(s.serviceId) && s.serviceId !== 'multipleservices');

  return [...critical, ...others];
}

interface RegionRowProps {
  regionId: string;
  regionName: string;
  geographicArea: string;
  overallStatus: StatusLevel;
  services: ServiceStatus[];
  provider: ProviderStatus['provider'];
}

function RegionRow({ regionName, geographicArea, overallStatus, services, provider }: RegionRowProps) {
  const [open, setOpen] = useState(false);

  // AWS uses "multipleservices" when broad regional impact is reported without
  // naming individual services. We can't accurately show per-service status in that case.
  const hasBroadImpactOnly =
    services.some((s) => s.serviceId === 'multipleservices') &&
    services.every((s) => s.serviceId === 'multipleservices');

  let displayServices: ServiceStatus[];
  if (provider === 'aws') {
    displayServices = buildServiceList(services, AWS_CRITICAL_SERVICE_IDS, AWS_SERVICE_NAMES);
  } else if (provider === 'gcp') {
    displayServices = buildServiceList(services, GCP_CRITICAL_SERVICE_IDS, GCP_SERVICE_NAMES);
  } else {
    displayServices = services;
  }

  return (
    <div className="border-b border-gray-100 dark:border-gray-800 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between py-2 px-1 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`shrink-0 w-2 h-2 rounded-full ${statusColor(overallStatus)}`} />
          <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{regionName}</span>
          <span className="text-xs text-gray-400 dark:text-gray-500 hidden sm:inline truncate">
            {geographicArea}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {overallStatus !== 'operational' && (
            <span className={`text-xs font-medium ${statusTextColor(overallStatus)}`}>
              {statusLabel(overallStatus)}
            </span>
          )}
          <svg
            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="pb-2 pt-1 bg-gray-50/50 dark:bg-gray-900/30">
          {hasBroadImpactOnly ? (
            <p className="text-xs text-yellow-700 dark:text-yellow-400 px-3 py-2 italic">
              AWS reports multiple services affected — individual service status unavailable. See active incidents for details.
            </p>
          ) : displayServices.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-1 italic">No service detail available.</p>
          ) : (
            displayServices.map((svc) => (
              <ServiceLine key={svc.serviceId} service={svc} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function RegionTable({ provider }: Props) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
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
    </div>
  );
}
