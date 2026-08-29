import { useRef, useState } from 'react';
import type { Provider, ProviderStatus } from '../types/status';

const VALID_PROVIDERS: Provider[] = ['aws', 'azure', 'gcp', 'oci'];

interface DeepLinkTarget {
  provider: Provider;
  incidentId: string;
}

// One-shot ?provider=&incidentId= link from an outage/resolution email (see
// README.md's Alerts & Admin section) — mirrors App.tsx's useUrlBanner()
// pattern: read once, strip from the URL, then scroll/expand once real data
// has loaded. Silently no-ops if the incident isn't found (e.g. an old
// resolution email for something that's since rolled off the feed).
export function useIncidentDeepLink() {
  const [target] = useState<DeepLinkTarget | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get('provider');
    const incidentId = params.get('incidentId');
    if (!provider || !incidentId || !VALID_PROVIDERS.includes(provider as Provider)) return null;

    params.delete('provider');
    params.delete('incidentId');
    const next = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (next ? `?${next}` : ''));
    return { provider: provider as Provider, incidentId };
  });
  const consumedRef = useRef(false);

  const consume = (providers: ProviderStatus[]) => {
    if (!target || consumedRef.current) return;
    const found = providers
      .find((p) => p.provider === target.provider)
      ?.activeIncidents.find((i) => i.id === target.incidentId);
    if (!found) return;

    consumedRef.current = true;
    document.getElementById(`incident-${target.provider}-${target.incidentId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return { deepLinkTarget: target, consume };
}
