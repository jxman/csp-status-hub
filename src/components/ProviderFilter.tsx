import type { MouseEvent } from 'react';
import type { Provider, ProviderStatus, StatusLevel } from '../types/status';
import { PROVIDER_LABELS, providerPagePath } from '../utils/providerPages';

interface Props {
  order: Provider[];
  focusProvider: Provider | null;
  providers: Record<Provider, ProviderStatus | null>;
  onSelect: (provider: Provider | null) => void;
}

const DOT_CLASS: Record<StatusLevel, string> = {
  operational: 'ok',
  degraded: 'warn',
  outage: 'bad',
  unknown: 'muted',
};

// "All · AWS · Azure · OCI · GCP" switcher. Real links (/, /aws, …) so
// crawlers and new tabs work; a plain click switches in place without a
// reload. Each provider's dot shows its live status, so a filtered page still
// shows at a glance when another provider is having problems.
export function ProviderFilter({ order, focusProvider, providers, onSelect }: Props) {
  const handleClick = (provider: Provider | null) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onSelect(provider);
  };

  return (
    <nav className="provider-filter" aria-label="Filter by provider">
      <a
        href={providerPagePath(null)}
        aria-current={focusProvider === null ? 'page' : undefined}
        onClick={handleClick(null)}
      >
        All providers
      </a>
      {order.map((id) => {
        const status = providers[id];
        return (
          <a
            key={id}
            href={providerPagePath(id)}
            aria-current={focusProvider === id ? 'page' : undefined}
            onClick={handleClick(id)}
          >
            <span className={`dot pf-dot ${status && !status.fetchError ? DOT_CLASS[status.overallStatus] : 'muted'}`} aria-hidden="true" />
            {PROVIDER_LABELS[id]}
          </a>
        );
      })}
    </nav>
  );
}
