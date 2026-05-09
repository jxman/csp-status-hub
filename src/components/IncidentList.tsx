import type { ProviderStatus } from '../types/status';
import { IncidentCard } from './IncidentCard';

interface Props {
  providers: ProviderStatus[];
}

export function IncidentList({ providers }: Props) {
  const allIncidents = providers.flatMap((p) =>
    p.activeIncidents.map((inc) => ({ incident: inc, provider: p.provider }))
  );

  const activeIncidents = allIncidents.filter(({ incident }) => incident.status !== 'resolved');
  const resolvedIncidents = allIncidents.filter(({ incident }) => incident.status === 'resolved');

  activeIncidents.sort((a, b) =>
    new Date(b.incident.updatedAt).getTime() - new Date(a.incident.updatedAt).getTime()
  );
  resolvedIncidents.sort((a, b) =>
    new Date(b.incident.updatedAt).getTime() - new Date(a.incident.updatedAt).getTime()
  );

  return (
    <section className="mt-4 sm:mt-6 px-3 sm:px-6">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Active Incidents{activeIncidents.length > 0 ? ` (${activeIncidents.length})` : ''}
      </h2>
      {activeIncidents.length === 0 ? (
        <div className="rounded-xl border border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-950/20 px-4 py-3">
          <p className="text-sm text-green-700 dark:text-green-400 font-medium">
            All systems operational — no active incidents
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {activeIncidents.map(({ incident, provider }) => (
            <IncidentCard key={`${provider}-${incident.id}`} incident={incident} provider={provider} />
          ))}
        </div>
      )}

      {resolvedIncidents.length > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
            Recently Resolved ({resolvedIncidents.length})
          </h2>
          <div className="space-y-3">
            {resolvedIncidents.map(({ incident, provider }) => (
              <IncidentCard key={`${provider}-${incident.id}`} incident={incident} provider={provider} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
