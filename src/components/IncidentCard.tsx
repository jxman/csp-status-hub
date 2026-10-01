import type { Incident, Provider } from '../types/status';
import { formatDateTime, formatRelative } from '../utils/formatters';
import { trackEvent } from '../utils/analytics';
import { IncidentBriefPanel } from './IncidentBriefPanel';

interface Props {
  incident: Incident;
  provider: Provider;
  autoExpand?: boolean;
  // Past incidents only: undefined = look the brief up as usual; a string =
  // that brief's row id; null = no brief was generated, so no AI panel.
  briefId?: string | null;
  // Past incidents show an absolute resolution date instead of "Nd ago".
  historical?: boolean;
  // Active incidents only: opens the sign-up form with this provider ticked.
  onSubscribe?: () => void;
}

const providerShort: Record<Provider, string> = {
  aws: 'AWS', azure: 'Azure', gcp: 'GCP', oci: 'OCI',
};

export function IncidentCard({ incident, provider, autoExpand, briefId, historical, onSubscribe }: Props) {
  const isResolved = incident.status === 'resolved';
  const sevClass = incident.severity === 'high' ? 'high' : 'med';
  const sevLabel = incident.severity === 'high' ? 'High' : incident.severity === 'medium' ? 'Med' : 'Low';

  const regionChips = incident.affectedRegions.slice(0, 2);
  const extraRegions = incident.affectedRegions.length - regionChips.length;

  return (
    <div id={`incident-${provider}-${incident.id}`} className={`incident${isResolved ? ' resolved' : ''}`}>
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
            ? `Resolved ${historical ? formatDateTime(incident.endTime) : formatRelative(incident.endTime)}`
            : `Updated ${formatRelative(incident.updatedAt)}`}
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
        <span className="inc-foot-links">
        {onSubscribe && (
          <button type="button" className="link-btn" onClick={onSubscribe}>
            🔔 Alert me about {providerShort[provider]}
          </button>
        )}
        {incident.detailUrl && (
          <a
            href={incident.detailUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackEvent('outbound_status_click', { provider, incident_id: incident.id })}
          >
            View timeline →
          </a>
        )}
        </span>
      </div>

      {briefId !== null && (
        <IncidentBriefPanel
          provider={provider}
          incidentId={incident.id}
          incident={incident}
          autoExpand={autoExpand}
          briefId={briefId}
        />
      )}
    </div>
  );
}
