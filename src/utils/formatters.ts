function parseDate(iso: string): Date | null {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

export function formatTime(iso: string): string {
  const d = parseDate(iso);
  if (!d) return '—';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
}

export function formatDateTime(iso: string): string {
  const d = parseDate(iso);
  if (!d) return '—';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

export function formatRelative(iso: string): string {
  const d = parseDate(iso);
  if (!d) return '—';
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}
