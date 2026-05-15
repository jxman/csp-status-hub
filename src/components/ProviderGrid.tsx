import type { ProviderStatus } from '../types/status';
import { ProviderPanel } from './ProviderPanel';

interface Props {
  providers: ProviderStatus[];
}

const statusRank: Record<string, number> = { outage: 0, degraded: 1, unknown: 2, operational: 3 };

export function ProviderGrid({ providers }: Props) {
  const sorted = [...providers].sort(
    (a, b) => (statusRank[a.overallStatus] ?? 4) - (statusRank[b.overallStatus] ?? 4)
  );
  const allHealthy = sorted.every((p) => p.overallStatus === 'operational' || !!p.fetchError);

  return (
    <section className={`a-grid${allHealthy ? ' all-healthy' : ''}`}>
      {sorted.map((provider) => (
        <ProviderPanel key={provider.provider} provider={provider} />
      ))}
    </section>
  );
}
