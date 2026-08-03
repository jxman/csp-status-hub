interface Props {
  onClose: () => void;
}

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
          background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 18, padding: '40px 44px', maxWidth: 460, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--ink)', marginBottom: 6 }}>
          Cloud Status Hub
        </div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 20 }}>
          A unified status dashboard for AWS, Azure, GCP &amp; Oracle Cloud
        </div>

        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, margin: '0 0 22px' }}>
          Real-time operational status across all four major cloud providers in one place —
          region and service level breakdowns, active incidents, and auto-refreshing updates,
          instead of four browser tabs.
        </p>

        <div style={{ borderTop: '1px solid var(--border)', margin: '0 0 18px' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', flex: '0 0 auto',
            background: 'var(--chip-bg)', border: '1px solid var(--border-strong)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: 'var(--ink)',
          }}>
            JX
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
              John Xanthopoulos
            </div>
            <a
              href="https://synepho.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--blue)', textDecoration: 'none' }}
            >
              synepho.com
            </a>
          </div>
        </div>

        <div style={{
          borderTop: '1px solid var(--border)', paddingTop: 14,
          fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.6, letterSpacing: '0.01em',
        }}>
          Data sourced from official public status pages · Refreshes every 60s · Not affiliated
          with AWS, Azure, GCP, or Oracle
        </div>

        <button onClick={onClose} style={closeButtonStyle}>Close</button>
      </div>
    </div>
  );
}

const closeButtonStyle: React.CSSProperties = {
  display: 'block', marginTop: 22, marginLeft: 'auto',
  padding: '10px 24px', borderRadius: 10, border: '1px solid var(--border-strong)',
  background: 'var(--ink)', color: 'var(--bg)',
  fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
};
