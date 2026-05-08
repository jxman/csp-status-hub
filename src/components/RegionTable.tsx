import { useState } from 'react';
import type { ProviderStatus, ServiceStatus, StatusLevel } from '../types/status';
import { statusColor, statusLabel, statusTextColor } from '../utils/statusHelpers';
import { AWS_CRITICAL_SERVICE_IDS, AWS_SERVICE_NAMES } from '../utils/awsServices';

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

function buildAwsServiceList(feedServices: ServiceStatus[]): ServiceStatus[] {
  const feedMap = new Map(feedServices.map((s) => [s.serviceId, s]));

  // Critical services always shown — operational unless feed says otherwise
  const critical: ServiceStatus[] = AWS_CRITICAL_SERVICE_IDS.map((id) =>
    feedMap.get(id) ?? {
      serviceId: id,
      serviceName: AWS_SERVICE_NAMES[id] ?? id,
      status: 'operational' as StatusLevel,
      incidents: [],
    }
  );
  const criticalIds = new Set(AWS_CRITICAL_SERVICE_IDS);

  // Non-critical services from the feed that aren't in the critical list
  const others = feedServices.filter((s) => !criticalIds.has(s.serviceId));

  return [...critical, ...others];
}

interface RegionRowProps {
  regionId: string;
  regionName: string;
  geographicArea: string;
  overallStatus: StatusLevel;
  services: ServiceStatus[];
  isAws: boolean;
}

function RegionRow({ regionName, geographicArea, overallStatus, services, isAws }: RegionRowProps) {
  const [open, setOpen] = useState(false);
  const displayServices = isAws ? buildAwsServiceList(services) : services;

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
          {displayServices.length === 0 ? (
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
  const isAws = provider.provider === 'aws';

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
          isAws={isAws}
        />
      ))}
    </div>
  );
}
