import type { StatusLevel } from '../types/status';

export interface FlatService {
  id: string;
  name: string;
  status?: StatusLevel;
}

export const MULTIPLE_SERVICES_ID = 'multipleservices';

interface Props {
  services: FlatService[];
  status: StatusLevel;
  footnoteUrl?: string;
  footnoteLabel?: string;
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

export function FlatServiceList({ services, status, footnoteUrl, footnoteLabel }: Props) {
  const hasMultiple = services.some((svc) => svc.id === MULTIPLE_SERVICES_ID);
  return (
    <div className="svc-list">
      {services.map((svc) => {
        const svcStatus = svc.status ?? status;
        const cls = svcStatusClass(svcStatus);
        const isMultiple = svc.id === MULTIPLE_SERVICES_ID;
        return (
          <>
            <div key={`${svc.id}-n`} className="svc" style={isMultiple ? { fontWeight: 600 } : undefined}>
              {svc.name}
            </div>
            <div key={`${svc.id}-s`} className={`status ${cls}`}>
              <span className="d" />{svcStatusLabel(svcStatus)}
            </div>
          </>
        );
      })}
      {hasMultiple && footnoteUrl && (
        <p style={{ gridColumn: '1/-1', fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic', margin: '4px 0 0' }}>
          * See{' '}
          <a href={footnoteUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--blue)' }}>
            {footnoteLabel ?? 'official status page'}
          </a>{' '}
          for full listing.
        </p>
      )}
    </div>
  );
}
