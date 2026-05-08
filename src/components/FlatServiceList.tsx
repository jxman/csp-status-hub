import type { StatusLevel } from '../types/status';
import { statusLabel, statusTextColor } from '../utils/statusHelpers';

interface Service {
  id: string;
  name: string;
}

interface Props {
  services: Service[];
  status: StatusLevel;
}

export function FlatServiceList({ services, status }: Props) {
  return (
    <div className="rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden">
      {services.map((svc) => (
        <div
          key={svc.id}
          className="flex items-center justify-between py-2 px-3 border-b border-gray-100 dark:border-gray-800 last:border-0"
        >
          <span className="text-sm text-gray-800 dark:text-gray-200">{svc.name}</span>
          <span className={`text-xs font-medium ${statusTextColor(status)}`}>
            {statusLabel(status)}
          </span>
        </div>
      ))}
    </div>
  );
}
