import { useCallback, useRef, useState } from 'react';
import type { Provider } from '../types/status';
import { fetchLatestIncidentBrief, type LatestBrief } from '../fetchers/analysisFetcher';

type BriefState = 'idle' | 'loading' | 'loaded' | 'error';

interface UseIncidentBrief {
  state: BriefState;
  brief: LatestBrief | null;
  error: string | null;
  load: () => void;
  retry: () => void;
}

export function useIncidentBrief(provider: Provider, incidentId: string): UseIncidentBrief {
  const [state, setState] = useState<BriefState>('idle');
  const [brief, setBrief] = useState<LatestBrief | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchNow = useCallback(() => {
    setState('loading');
    fetchLatestIncidentBrief(provider, incidentId)
      .then((result) => {
        setBrief(result);
        setState('loaded');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });
  }, [provider, incidentId]);

  const load = useCallback(() => {
    if (stateRef.current === 'loading' || stateRef.current === 'loaded') return;
    fetchNow();
  }, [fetchNow]);

  const retry = useCallback(() => {
    setState('idle');
    fetchNow();
  }, [fetchNow]);

  return { state, brief, error, load, retry };
}
