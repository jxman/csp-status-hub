import type { StatusLevel } from '../types/status';

export interface FlatService {
  id: string;
  name: string;
  status?: StatusLevel;
}

interface Props {
  services: FlatService[];
  status: StatusLevel;
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

export function FlatServiceList({ services, status }: Props) {
  return (
    <div className="svc-list">
      {services.map((svc) => {
        const svcStatus = svc.status ?? status;
        const cls = svcStatusClass(svcStatus);
        return (
          <>
            <div key={`${svc.id}-n`} className="svc">{svc.name}</div>
            <div key={`${svc.id}-s`} className={`status ${cls}`}>
              <span className="d" />{svcStatusLabel(svcStatus)}
            </div>
          </>
        );
      })}
    </div>
  );
}
