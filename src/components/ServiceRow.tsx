import type { ServiceStatus } from '../types/status';
import { statusColor, statusLabel } from '../utils/statusHelpers';

interface Props {
  service: ServiceStatus;
}

export function ServiceRow({ service }: Props) {
  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <span className="text-sm text-gray-700 dark:text-gray-300 truncate mr-2">{service.serviceName}</span>
      <span
        className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white ${statusColor(service.status)}`}
      >
        {statusLabel(service.status)}
      </span>
    </div>
  );
}
