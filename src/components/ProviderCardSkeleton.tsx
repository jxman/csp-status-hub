import type { Provider } from '../types/status';

interface Props {
  provider: Provider;
}

const SHORT_NAMES: Record<Provider, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP', oci: 'OCI' };

export function ProviderCardSkeleton({ provider }: Props) {
  return (
    <div className="pcard" style={{ minHeight: 120 }}>
      <div className="pcard-head">
        <div className="pcard-titlerow">
          <div className="pcard-name">
            <span className="short">{SHORT_NAMES[provider]}</span>
          </div>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: 'var(--ink-4)',
            flexShrink: 0, animation: 'pulse-skeleton 1.4s ease-in-out infinite',
          }} />
        </div>
        <div className="pcard-sub" style={{ animation: 'pulse-skeleton 1.4s ease-in-out infinite' }}>
          Checking status…
        </div>
      </div>
    </div>
  );
}
