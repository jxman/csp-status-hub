import type { Incident, Provider } from '../types/status';
import { formatDateTime, formatRelative } from '../utils/formatters';

interface Props {
  incident: Incident;
  provider: Provider;
}

const providerShort: Record<Provider, string> = {
  aws: 'AWS', azure: 'Azure', gcp: 'GCP', oci: 'OCI',
};

export function IncidentCard({ incident, provider }: Props) {
  const isResolved = incident.status === 'resolved';
  const sevClass = incident.severity === 'high' ? 'high' : 'med';
  const sevLabel = incident.severity === 'high' ? 'High' : incident.severity === 'medium' ? 'Med' : 'Low';

  const regionChips = incident.affectedRegions.slice(0, 2);
  const extraRegions = incident.affectedRegions.length - regionChips.length;

  return (
    <div className={`incident${isResolved ? ' resolved' : ''}`}>
      <div>
        <div className="inc-title">{incident.title}</div>
        <div className="inc-meta">
          <span className="chip">{providerShort[provider]}</span>
          {regionChips.map((r) => (
            <span key={r} className="chip">{r}</span>
          ))}
          {extraRegions > 0 && (
            <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>+{extraRegions} more</span>
          )}
        </div>
      </div>

      <div className="inc-right">
        {isResolved ? (
          <span className="sev" style={{ background: 'var(--green-soft)', color: 'var(--green-text)' }}>
            Resolved
          </span>
        ) : (
          <span className={`sev ${sevClass}`}>{sevLabel}</span>
        )}
        <span className="inc-time">
          {isResolved && incident.endTime
            ? `Resolved ${formatRelative(incident.endTime)}`
            : formatDateTime(incident.startTime)}
        </span>
      </div>

      {incident.latestUpdate && (
        <div className="inc-body">{incident.latestUpdate}</div>
      )}

      <div className="inc-foot">
        {incident.affectedServices.length > 0 ? (
          <span>Affects: {incident.affectedServices.join(', ')}</span>
        ) : (
          <span>Updated {formatRelative(incident.updatedAt)}</span>
        )}
        {incident.detailUrl && (
          <a href={incident.detailUrl} target="_blank" rel="noopener noreferrer">
            View timeline →
          </a>
        )}
      </div>
    </div>
  );
}
