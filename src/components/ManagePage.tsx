import { useEffect, useState } from 'react';

const PROVIDERS: { id: string; label: string }[] = [
  { id: 'aws', label: 'AWS' },
  { id: 'azure', label: 'Azure' },
  { id: 'gcp', label: 'GCP' },
  { id: 'oci', label: 'OCI' },
];

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not-found' }
  | { kind: 'ready'; name: string; email: string };

export function ManagePage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allProviders, setAllProviders] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!token) {
      setState({ kind: 'not-found' });
      return;
    }
    fetch(`/api/subscribe/manage?token=${encodeURIComponent(token)}`)
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then((data: { name: string; email: string; providers: string[] }) => {
        setState({ kind: 'ready', name: data.name, email: data.email });
        if (data.providers.includes('all')) {
          setAllProviders(true);
        } else {
          setSelected(new Set(data.providers));
        }
      })
      .catch(() => setState({ kind: 'not-found' }));
  }, [token]);

  function toggleProvider(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    const providers = allProviders ? ['all'] : Array.from(selected);
    if (providers.length === 0) return;

    setSaveState('saving');
    try {
      const res = await fetch('/api/subscribe/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, providers }),
      });
      if (!res.ok) throw new Error();
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, padding: '32px 36px', maxWidth: 420, width: '100%',
        boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>Manage subscription</div>

        {state.kind === 'loading' && (
          <div style={{ fontSize: 14, color: 'var(--ink-2)' }}>Loading…</div>
        )}

        {state.kind === 'not-found' && (
          <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            This link is invalid or your subscription has already been removed.
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {state.name} · {state.email}
            </div>

            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)', marginBottom: 6, display: 'block' }}>
                Providers
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--ink)' }}>
                  <input type="checkbox" checked={allProviders} onChange={(e) => setAllProviders(e.target.checked)} />
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

            {saveState === 'error' && (
              <div style={{ fontSize: 13, color: 'var(--red-text)' }}>Something went wrong. Please try again.</div>
            )}
            {saveState === 'saved' && (
              <div style={{ fontSize: 13, color: 'var(--green-text)' }}>Saved.</div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <a
                href={`/api/subscribe/unsubscribe?token=${encodeURIComponent(token)}`}
                style={{ fontSize: 13, color: 'var(--ink-3)' }}
              >
                Unsubscribe
              </a>
              <button
                onClick={handleSave}
                disabled={saveState === 'saving'}
                style={{
                  padding: '8px 18px', borderRadius: 7, border: '1px solid var(--border-strong)',
                  background: 'var(--ink)', color: 'var(--bg)',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {saveState === 'saving' ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
