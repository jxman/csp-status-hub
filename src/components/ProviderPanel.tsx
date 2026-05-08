import { useState } from 'react';
import type { ProviderStatus } from '../types/status';
import { statusColor, statusLabel, statusTextColor } from '../utils/statusHelpers';
import { RegionTable } from './RegionTable';
import { FlatServiceList } from './FlatServiceList';
import { ErrorState } from './ErrorState';
import { OCI_CRITICAL_SERVICES } from '../utils/ociServices';
import { GCP_CRITICAL_SERVICES } from '../utils/gcpServices';

interface Props {
  provider: ProviderStatus;
  defaultExpanded?: boolean;
}

const providerLogos: Record<string, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  oci: 'OCI',
};

export function ProviderPanel({ provider, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (provider.fetchError && provider.regions.length === 0 && provider.activeIncidents.length === 0 && !provider.coverageNote) {
    return <ErrorState provider={provider.provider} error={provider.fetchError} />;
  }

  const incidentCount = provider.activeIncidents.length;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/60 overflow-hidden transition-all shadow-sm">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between px-5 py-4
          hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">
            {providerLogos[provider.provider]}
          </span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">{provider.displayName}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${statusTextColor(provider.overallStatus)}`}>
            {statusLabel(provider.overallStatus)}
          </span>
          <span className={`w-2.5 h-2.5 rounded-full ${statusColor(provider.overallStatus)}`} />
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {!expanded && incidentCount > 0 && (
        <div className="px-5 pb-3">
          <span className="text-xs text-yellow-600 dark:text-yellow-400">
            {incidentCount} active incident{incidentCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 px-5 py-4 space-y-4">
          {provider.coverageNote && (
            <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/40 px-3 py-2">
              <p className="text-xs text-blue-700 dark:text-blue-300">{provider.coverageNote}</p>
            </div>
          )}

          {provider.fetchError && (
            <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800/40 px-3 py-2">
              <p className="text-xs text-yellow-700 dark:text-yellow-300">{provider.fetchError}</p>
            </div>
          )}

          {provider.provider === 'oci' ? (
            <FlatServiceList services={OCI_CRITICAL_SERVICES} status={provider.overallStatus} />
          ) : provider.provider === 'gcp' && provider.regions.length === 0 ? (
            <FlatServiceList services={GCP_CRITICAL_SERVICES} status={provider.overallStatus} />
          ) : provider.regions.length > 0 ? (
            <RegionTable provider={provider} />
          ) : provider.activeIncidents.length === 0 && !provider.fetchError ? (
            <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800/40 px-3 py-2">
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">No active incidents</p>
            </div>
          ) : null}

          <div className="flex items-center justify-between pt-1">
            <span className="text-xs text-gray-400 dark:text-gray-600">
              {incidentCount > 0 ? `${incidentCount} active incident${incidentCount !== 1 ? 's' : ''}` : 'No active incidents'}
            </span>
            <a
              href={provider.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              Official status page →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
