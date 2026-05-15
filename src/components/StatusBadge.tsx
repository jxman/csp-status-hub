import type { StatusLevel } from '../types/status';

interface Props {
  status: StatusLevel;
  size?: 'sm' | 'md' | 'lg'; // kept for API compat; CSS handles size
}

function pillClass(status: StatusLevel): string {
  switch (status) {
    case 'operational': return 'pill ok';
    case 'degraded':    return 'pill warn';
    case 'outage':      return 'pill bad';
    case 'unknown':     return 'pill muted';
  }
}

function pillLabel(status: StatusLevel): string {
  switch (status) {
    case 'operational': return 'Operational';
    case 'degraded':    return 'Degraded';
    case 'outage':      return 'Outage';
    case 'unknown':     return 'Unknown';
  }
}

export function StatusBadge({ status }: Props) {
  return (
    <span className={pillClass(status)}>
      <span className="dot" />
      {pillLabel(status)}
    </span>
  );
}
