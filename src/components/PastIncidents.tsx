import { useState } from 'react';
import { fetchPastIncidents, type PastIncident } from '../fetchers/historyFetcher';
import { trackEvent } from '../utils/analytics';
import { IncidentCard } from './IncidentCard';

interface Props {
  // "provider:id" keys already shown under Recently resolved — skipped here so
  // an incident near the 24h boundary (or behind the 1h edge cache) never
  // appears twice.
  excludeKeys: Set<string>;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export function PastIncidents({ excludeKeys }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>('idle');
  const [items, setItems] = useState<PastIncident[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [retentionDays, setRetentionDays] = useState(90);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirstPage = () => {
    setState('loading');
    fetchPastIncidents()
      .then((page) => {
        setItems(page.incidents);
        setNextCursor(page.nextCursor);
        setRetentionDays(page.retentionDays);
        setState('loaded');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      trackEvent('past_incidents_expand', {});
      // Fetched once per page view; the list doesn't take part in polling.
      if (state === 'idle' || state === 'error') loadFirstPage();
    }
  };

  const loadMore = () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    fetchPastIncidents(nextCursor)
      .then((page) => {
        setItems((prev) => [...prev, ...page.incidents]);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingMore(false));
  };

  const visible = items.filter(({ provider, incident }) => !excludeKeys.has(`${provider}:${incident.id}`));

  return (
    <div className="past-incidents">
      <button type="button" className="past-toggle" onClick={toggle} aria-expanded={open}>
        <span className={`past-chevron${open ? ' open' : ''}`} aria-hidden="true">▸</span>
        Past incidents · last {retentionDays} days
        {state === 'loaded' && ` · ${visible.length}${nextCursor ? '+' : ''}`}
      </button>

      {open && (
        <div className="past-list">
          {state === 'loading' && <div className="all-clear-msg">Loading past incidents…</div>}

          {state === 'error' && (
            <div className="all-clear-msg">
              Couldn&apos;t load past incidents ({error}).{' '}
              <button className="btn-ghost" onClick={loadFirstPage}>Retry</button>
            </div>
          )}

          {state === 'loaded' && visible.length === 0 && (
            <div className="all-clear-msg">No incidents resolved in the last {retentionDays} days.</div>
          )}

          {state === 'loaded' &&
            visible.map(({ provider, incident, briefId }) => (
              <IncidentCard
                key={`${provider}-${incident.id}`}
                incident={incident}
                provider={provider}
                briefId={briefId}
                historical
              />
            ))}

          {state === 'loaded' && nextCursor && (
            <button className="btn-ghost" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load older incidents'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
