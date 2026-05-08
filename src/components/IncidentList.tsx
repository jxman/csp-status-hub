import type { ProviderStatus } from '../types/status';
import { IncidentCard } from './IncidentCard';

interface Props {
  providers: ProviderStatus[];
}

export function IncidentList({ providers }: Props) {
  const allIncidents = providers.flatMap((p) =>
    p.activeIncidents.map((inc) => ({ incident: inc, provider: p.provider }))
  );

  allIncidents.sort((a, b) =>
    new Date(b.incident.updatedAt).getTime() - new Date(a.incident.updatedAt).getTime()
  );

  if (allIncidents.length === 0) {
    return (
      <section className="mt-6 px-6">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
          Active Incidents
        </h2>
        <div className="rounded-xl border border-green-200 dark:border-green-800/40 bg-green-50 dark:bg-green-950/20 px-4 py-3">
          <p className="text-sm text-green-700 dark:text-green-400 font-medium">
            All systems operational — no active incidents
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-6 px-6">
      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        Active Incidents ({allIncidents.length})
      </h2>
      <div className="space-y-3">
        {allIncidents.map(({ incident, provider }) => (
          <IncidentCard key={`${provider}-${incident.id}`} incident={incident} provider={provider} />
        ))}
      </div>
    </section>
  );
}
