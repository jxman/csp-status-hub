import { formatDate } from '../utils/formatters';
import { SynephoLogo } from './SynephoLogo';

interface Props {
  onClose: () => void;
}

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export function AboutModal({ onClose }: Props) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'relative',
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 20, padding: '44px 48px', maxWidth: 480, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 20, right: 20,
            width: 36, height: 36, borderRadius: 10,
            border: '1px solid var(--border-strong)', background: 'var(--card)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--ink-3)', cursor: 'pointer',
          }}
        >
          <CloseIcon />
        </button>

        <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.01em', marginBottom: 8, paddingRight: 40 }}>
          Cloud Status Hub
        </div>
        <div style={{ fontSize: 15, color: 'var(--ink-3)', marginBottom: 20 }}>
          A unified status dashboard for AWS, Azure, GCP &amp; Oracle Cloud
        </div>

        <p style={{ fontSize: 15, color: 'var(--ink-2)', lineHeight: 1.65, margin: '0 0 22px' }}>
          Real-time status for AWS, Azure, GCP &amp; Oracle Cloud in one place, instead of four
          browser tabs. Every active incident gets an <strong>AI Insight</strong> panel —
          Bedrock-generated technical and executive briefs, downloadable as PDF — so it arrives
          with a starting-point analysis, not just a status change.
        </p>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 0 20px' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
          <a
            href="https://synepho.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' }}
          >
            <SynephoLogo height={30} />
          </a>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>
              John Xanthopoulos
            </div>
            <a
              href="https://synepho.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 13, color: 'var(--blue)', textDecoration: 'none',
              }}
            >
              synepho.com <ExternalLinkIcon />
            </a>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 0 14px' }} />

        <div style={{ fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
          <div style={{ marginBottom: 4 }}>
            Version {__APP_VERSION__} · Updated {formatDate(__BUILD_DATE__)}
          </div>
          <div>
            Data sourced from official public status pages · Refreshes every 60s · Not
            affiliated with AWS, Azure, GCP, or Oracle
          </div>
        </div>
      </div>
    </div>
  );
}
