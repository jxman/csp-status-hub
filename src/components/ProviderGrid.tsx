import type { Provider, ProviderStatus } from '../types/status';
import { ProviderPanel } from './ProviderPanel';
import { ProviderCardSkeleton } from './ProviderCardSkeleton';

export interface ProviderSlot {
  provider: Provider;
  status: ProviderStatus | null;
}

interface Props {
  slots: ProviderSlot[];
}

export function ProviderGrid({ slots }: Props) {
  const allHealthy = slots.every(
    (s) => s.status !== null && (s.status.overallStatus === 'operational' || !!s.status.fetchError)
  );

  return (
    <section className={`a-grid${allHealthy ? ' all-healthy' : ''}`}>
      {slots.map((slot) =>
        slot.status === null
          ? <ProviderCardSkeleton key={slot.provider} />
          : <ProviderPanel key={slot.provider} provider={slot.status} />
      )}
    </section>
  );
}
