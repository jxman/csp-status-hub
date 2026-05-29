import { useState } from 'react';
import type { Incident, StatusLevel } from '../types/status';
import { StatusBadge } from './StatusBadge';

function incidentBadgeStatus(incident: Incident): StatusLevel {
  if (incident.status === 'resolved') return 'operational';
  return incident.severity === 'high' ? 'outage' : 'degraded';
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

function IncidentRow({ incident }: { incident: Incident }) {
  const [open, setOpen] = useState(false);
  const badgeStatus = incidentBadgeStatus(incident);
  const svcClass = badgeStatus === 'outage' ? 'bad' : badgeStatus === 'degraded' ? 'warn' : 'ok';
  const svcLabel = badgeStatus === 'outage' ? 'Outage' : badgeStatus === 'degraded' ? 'Degraded' : 'Operational';

  // Primary label: region name(s) if available, else a stripped incident title
  const primaryLabel = incident.affectedRegions.length > 0
    ? incident.affectedRegions.join(' · ')
    : incident.title.replace(/^(Active|Investigating|Monitoring|Identified|Mitigated|Resolved)\s*[–-]\s*/i, '').trim();

  const update = incident.latestUpdate && incident.latestUpdate.length > 420
    ? incident.latestUpdate.slice(0, 420) + '…'
    : incident.latestUpdate;

  return (
    <div className="region-block">
      <div
        className="region-head"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}
      >
        <div className="region-name">
          <span className="region-label">{primaryLabel}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StatusBadge status={badgeStatus} />
          <ChevronDown open={open} />
        </div>
      </div>

      {open && (
        <>
          {/* Full incident title as context inside the expanded area */}
          <p style={{ margin: '6px 0 2px', fontSize: 12, color: 'var(--ink-2)', fontWeight: 500, lineHeight: 1.4 }}>
            {incident.title}
          </p>
          {incident.affectedServices.length > 0 && (
            <div className="svc-list">
              {incident.affectedServices.map((svc) => (
                <>
                  <div key={`${svc}-n`} className="svc">{svc}</div>
                  <div key={`${svc}-s`} className={`status ${svcClass}`}>
                    <span className="d" />{svcLabel}
                  </div>
                </>
              ))}
            </div>
          )}
          {update && (
            <p style={{ margin: '4px 0 8px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
              {update}
            </p>
          )}
        </>
      )}
    </div>
  );
}

interface Props {
  incidents: Incident[];
}

export function IncidentTable({ incidents }: Props) {
  const active = incidents.filter((inc) => inc.status !== 'resolved');
  return (
    <>
      {active.map((inc) => (
        <IncidentRow key={inc.id} incident={inc} />
      ))}
    </>
  );
}
