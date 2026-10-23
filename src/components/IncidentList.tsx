import type { Provider, ProviderStatus } from '../types/status';
import type { SubscribeSource } from './SubscribeModal';
import { IncidentCard } from './IncidentCard';
import { PastIncidents } from './PastIncidents';
import { PROVIDER_LABELS } from '../utils/providerPages';

interface Props {
  providers: ProviderStatus[];
  deepLinkTarget?: { provider: Provider; incidentId: string } | null;
  onSubscribe?: (source: SubscribeSource, provider?: Provider) => void;
  // Set on a provider page (/aws etc.); `providers` is already filtered to it.
  focusProvider?: Provider | null;
}

export function IncidentList({ providers, deepLinkTarget, onSubscribe, focusProvider }: Props) {
  const allIncidents = providers.flatMap((p) =>
    p.activeIncidents.map((inc) => ({ incident: inc, provider: p.provider }))
  );

  const active = allIncidents.filter(({ incident }) => incident.status !== 'resolved');
  const resolved = allIncidents.filter(({ incident }) => incident.status === 'resolved');

  active.sort((a, b) => new Date(b.incident.updatedAt).getTime() - new Date(a.incident.updatedAt).getTime());
  resolved.sort((a, b) => new Date(b.incident.updatedAt).getTime() - new Date(a.incident.updatedAt).getTime());

  const isDeepLinkTarget = (provider: Provider, incidentId: string) =>
    deepLinkTarget?.provider === provider && deepLinkTarget?.incidentId === incidentId;

  return (
    <div className="incidents-section">
      <h2>Active incidents{active.length > 0 ? ` · ${active.length}` : ''}</h2>
      {active.length === 0 ? (
        <div className="all-clear-msg">
          {focusProvider
            ? `No active ${PROVIDER_LABELS[focusProvider]} incidents — all ${PROVIDER_LABELS[focusProvider]} services operational.`
            : 'No active incidents — all systems operational.'}
          {onSubscribe && (
            <>
              {' '}
              <button type="button" className="link-btn" onClick={() => onSubscribe('all_clear', focusProvider ?? undefined)}>
                Get an email the moment that changes →
              </button>
            </>
          )}
        </div>
      ) : (
        active.map(({ incident, provider }) => (
          <IncidentCard
            key={`${provider}-${incident.id}`}
            incident={incident}
            provider={provider}
            autoExpand={isDeepLinkTarget(provider, incident.id)}
            onSubscribe={onSubscribe ? () => onSubscribe('incident_card', provider) : undefined}
          />
        ))
      )}

      {resolved.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Recently resolved · {resolved.length}</h2>
          {resolved.map(({ incident, provider }) => (
            <IncidentCard
              key={`${provider}-${incident.id}`}
              incident={incident}
              provider={provider}
              autoExpand={isDeepLinkTarget(provider, incident.id)}
            />
          ))}
        </>
      )}

      {/* Keyed by provider so switching the filter starts a fresh, collapsed list */}
      <PastIncidents
        key={focusProvider ?? 'all'}
        excludeKeys={new Set(resolved.map(({ provider, incident }) => `${provider}:${incident.id}`))}
        provider={focusProvider}
      />
    </div>
  );
}
