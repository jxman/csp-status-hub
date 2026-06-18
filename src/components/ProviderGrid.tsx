import type { ProviderStatus } from '../types/status';
import { ProviderPanel } from './ProviderPanel';

interface Props {
  providers: ProviderStatus[];
}

export function ProviderGrid({ providers }: Props) {
  const allHealthy = providers.every((p) => p.overallStatus === 'operational' || !!p.fetchError);

  return (
    <section className={`a-grid${allHealthy ? ' all-healthy' : ''}`}>
      {providers.map((provider) => (
        <ProviderPanel key={provider.provider} provider={provider} />
      ))}
    </section>
  );
}
