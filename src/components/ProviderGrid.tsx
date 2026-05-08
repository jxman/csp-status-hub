import type { ProviderStatus } from '../types/status';
import { ProviderPanel } from './ProviderPanel';

interface Props {
  providers: ProviderStatus[];
}

export function ProviderGrid({ providers }: Props) {
  return (
    <section className="px-3 sm:px-6 pt-4 sm:pt-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {providers.map((provider) => (
          <ProviderPanel
            key={provider.provider}
            provider={provider}
            defaultExpanded={provider.activeIncidents.length > 0}
          />
        ))}
      </div>
    </section>
  );
}
