import type { Provider, ProviderStatus } from '../types/status';
import { ProviderPanel } from './ProviderPanel';
import { ProviderCardSkeleton } from './ProviderCardSkeleton';

export interface ProviderSlot {
  provider: Provider;
  status: ProviderStatus | null;
}

interface Props {
  slots: ProviderSlot[];
  // Set on a provider landing page (/aws etc.): that card opens by default
  // and drops its link to its own page.
  focusProvider?: Provider | null;
}

export function ProviderGrid({ slots, focusProvider }: Props) {
  const allHealthy = slots.every(
    (s) => s.status !== null && (s.status.overallStatus === 'operational' || !!s.status.fetchError)
  );

  return (
    <section className={`a-grid${allHealthy ? ' all-healthy' : ''}`}>
      {slots.map((slot) =>
        slot.status === null
          ? <ProviderCardSkeleton key={slot.provider} provider={slot.provider} />
          : (
            <ProviderPanel
              key={slot.provider}
              provider={slot.status}
              isFocused={slot.provider === focusProvider}
            />
          )
      )}
    </section>
  );
}
