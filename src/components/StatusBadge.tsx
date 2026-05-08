import type { StatusLevel } from '../types/status';
import { statusColor, statusLabel } from '../utils/statusHelpers';

interface Props {
  status: StatusLevel;
  size?: 'sm' | 'md' | 'lg';
}

export function StatusBadge({ status, size = 'md' }: Props) {
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-3 py-1.5',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium text-white ${statusColor(status)} ${sizeClasses[size]}`}
    >
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/70" />
      {statusLabel(status)}
    </span>
  );
}
