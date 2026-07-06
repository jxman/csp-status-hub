import { useState } from 'react';

interface Props {
  onClose: () => void;
}

const PROVIDERS: { id: string; label: string }[] = [
  { id: 'aws', label: 'AWS' },
  { id: 'azure', label: 'Azure' },
  { id: 'gcp', label: 'GCP' },
  { id: 'oci', label: 'OCI' },
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--ink)',
  fontSize: 14,
  fontFamily: 'inherit',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-2)',
  marginBottom: 6,
  display: 'block',
};

export function SubscribeModal({ onClose }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allProviders, setAllProviders] = useState(false);
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  function toggleProvider(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage('');

    const providers = allProviders ? ['all'] : Array.from(selected);
    if (providers.length === 0) {
      setErrorMessage('Select at least one provider.');
      return;
    }

    setStatus('submitting');
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, providers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Something went wrong. Please try again.');
      }
      setStatus('done');
    } catch (err) {
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
  }

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
          borderRadius: 14, padding: '32px 36px', maxWidth: 420, width: '100%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {status === 'done' ? (
          <>
            <div style={{ fontSize: 32, lineHeight: 1 }}>📬</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Check your inbox</div>
            <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
              If that email isn't already subscribed, we've sent a confirmation link to <strong>{email}</strong>. Click it to start receiving outage alerts.
            </div>
            <button onClick={onClose} style={closeButtonStyle}>Done</button>
          </>
        ) : (
          <>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>
                🔔 Subscribe to alerts
              </div>
              <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
                Get an email when a provider you follow reports a new outage. We'll send a confirmation link first.
              </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle} htmlFor="subscribe-name">Name</label>
                <input
                  id="subscribe-name"
                  style={inputStyle}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>

              <div>
                <label style={labelStyle} htmlFor="subscribe-email">Email</label>
                <input
                  id="subscribe-email"
                  type="email"
                  style={inputStyle}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </div>

              <div>
                <span style={labelStyle}>Providers</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
                    <input
                      type="checkbox"
                      checked={allProviders}
                      onChange={(e) => setAllProviders(e.target.checked)}
                    />
                    All providers
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', paddingLeft: 4, opacity: allProviders ? 0.5 : 1 }}>
                    {PROVIDERS.map((p) => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--ink)' }}>
                        <input
                          type="checkbox"
                          disabled={allProviders}
                          checked={selected.has(p.id)}
                          onChange={() => toggleProvider(p.id)}
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {errorMessage && (
                <div style={{ fontSize: 13, color: 'var(--red-text)' }}>{errorMessage}</div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button type="button" onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
                <button type="submit" disabled={status === 'submitting'} style={closeButtonStyle}>
                  {status === 'submitting' ? 'Sending…' : 'Subscribe'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

const closeButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-end',
  padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border-strong)',
  background: 'var(--ink)', color: 'var(--bg)',
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border-strong)',
  background: 'transparent', color: 'var(--ink)',
  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
};
