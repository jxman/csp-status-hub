import type { Incident, Provider } from '../types/status';
import { severityColor, severityLabel, statusDot } from '../utils/statusHelpers';
import { formatDateTime, formatRelative } from '../utils/formatters';

interface Props {
  incident: Incident;
  provider: Provider;
}

const providerShort: Record<Provider, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  oci: 'OCI',
};

export function IncidentCard({ incident, provider }: Props) {
  const isResolved = incident.status === 'resolved';

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${
      isResolved
        ? 'border-green-200 dark:border-green-800/40 bg-green-50/50 dark:bg-green-950/20'
        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/50'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <span className="text-base mt-0.5 shrink-0">
            {isResolved ? '🟢' : statusDot(incident.severity === 'high' ? 'outage' : 'degraded')}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{incident.title}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              <span className="font-medium text-gray-700 dark:text-gray-300">{providerShort[provider]}</span>
              {incident.affectedRegions.length > 0 && (
                <> · {incident.affectedRegions.slice(0, 3).join(', ')}{incident.affectedRegions.length > 3 ? ` +${incident.affectedRegions.length - 3}` : ''}</>
              )}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          {isResolved ? (
            <span className="text-xs font-semibold text-green-600 dark:text-green-400">Resolved</span>
          ) : (
            <span className={`text-xs font-semibold ${severityColor(incident.severity)}`}>
              {severityLabel(incident.severity)}
            </span>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {isResolved && incident.endTime ? formatDateTime(incident.endTime) : formatDateTime(incident.startTime)}
          </p>
        </div>
      </div>

      {incident.latestUpdate && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{incident.latestUpdate}</p>
      )}

      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs text-gray-400 dark:text-gray-500">Updated {formatRelative(incident.updatedAt)}</span>
        {incident.detailUrl && (
          <a
            href={incident.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
          >
            View details →
          </a>
        )}
      </div>
    </div>
  );
}
