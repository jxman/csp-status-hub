import type { StatusLevel } from '../types/status';
import { statusLabel, statusTextColor } from '../utils/statusHelpers';

export interface FlatService {
  id: string;
  name: string;
  status?: StatusLevel;
}

interface Props {
  services: FlatService[];
  status: StatusLevel;
}

export function FlatServiceList({ services, status }: Props) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
      {services.map((svc) => {
        const svcStatus = svc.status ?? status;
        return (
          <div
            key={svc.id}
            className="flex items-center justify-between py-2 px-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
          >
            <span className="text-sm text-gray-800 dark:text-gray-200">{svc.name}</span>
            <span className={`text-xs font-medium ${statusTextColor(svcStatus)}`}>
              {statusLabel(svcStatus)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
