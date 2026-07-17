import { useCallback, useEffect, useState } from 'react';

interface Subscriber {
  id: string;
  name: string;
  email: string;
  providers: string[];
  pending_providers: string[] | null;
  status: string;
  created_at: string;
  unsubscribed_at: string | null;
}

interface Summary {
  total: number;
  confirmed: number;
  pending: number;
  unsubscribed: number;
  byProvider: { aws: number; azure: number; gcp: number; oci: number };
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'ready'; summary: Summary; subscribers: Subscriber[] };

const cellStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--border)' };
const buttonStyle: React.CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border-strong)',
  background: 'transparent', color: 'var(--ink)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
};
const linkStyle: React.CSSProperties = {
  ...buttonStyle, textDecoration: 'none', display: 'inline-block',
};

const VERCEL_PROJECT_URL = 'https://vercel.com/johns-projects-2d2073fd/csp-status-hub';
const opsLinks = [
  { label: 'Cron Jobs →', href: `${VERCEL_PROJECT_URL}/settings/cron-jobs` },
  { label: 'Runtime Logs →', href: `${VERCEL_PROJECT_URL}/logs` },
  { label: 'Deployments →', href: `${VERCEL_PROJECT_URL}/deployments` },
];

export function AdminPage() {
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState('');

  const authError = new URLSearchParams(window.location.search).get('error');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (provider) params.set('provider', provider);
    if (search) params.set('q', search);

    fetch(`/api/admin/subscribers?${params.toString()}`)
      .then((res) => {
        if (res.status === 401) {
          setState({ kind: 'signed-out' });
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data) setState({ kind: 'ready', summary: data.summary, subscribers: data.subscribers });
      })
      .catch(() => setState({ kind: 'signed-out' }));
  }, [status, provider, search]);

  useEffect(() => {
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
  }, [load]);

  async function runAction(id: string, action: 'resend_confirmation' | 'force_unsubscribe' | 'delete') {
    setActionError('');
    try {
      const res = await fetch(`/api/admin/subscribers/${id}`, {
        method: action === 'delete' ? 'DELETE' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'delete' ? undefined : JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Action failed');
      }
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    }
  }

  function exportCsv() {
    const params = new URLSearchParams({ format: 'csv' });
    if (status) params.set('status', status);
    if (provider) params.set('provider', provider);
    if (search) params.set('q', search);
    window.location.href = `/api/admin/subscribers?${params.toString()}`;
  }

  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST' });
    setState({ kind: 'signed-out' });
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 24px', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', marginBottom: 20 }}>
          CSP Status Hub — Admin
        </h1>

        {state.kind === 'loading' && <div style={{ color: 'var(--ink-2)', fontSize: 14 }}>Loading…</div>}

        {state.kind === 'signed-out' && (
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
            padding: 24, maxWidth: 400, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            {authError === 'forbidden' && (
              <div style={{ fontSize: 13, color: 'var(--red-text)' }}>
                That Vercel account isn't authorized for admin access.
              </div>
            )}
            {authError === '1' && (
              <div style={{ fontSize: 13, color: 'var(--red-text)' }}>Sign-in failed. Please try again.</div>
            )}
            <a
              href="/api/auth/authorize"
              style={{
                display: 'inline-block', textAlign: 'center', padding: '10px 16px', borderRadius: 8,
                background: 'var(--ink)', color: 'var(--bg)', fontSize: 14, fontWeight: 500, textDecoration: 'none',
              }}
            >
              Sign in with Vercel
            </a>
          </div>
        )}

        {state.kind === 'ready' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--ink-3)', marginRight: 4 }}>Vercel:</span>
              {opsLinks.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                  {link.label}
                </a>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              {[
                ['Total', state.summary.total],
                ['Confirmed', state.summary.confirmed],
                ['Pending', state.summary.pending],
                ['Unsubscribed', state.summary.unsubscribed],
                ['AWS', state.summary.byProvider.aws],
                ['Azure', state.summary.byProvider.azure],
                ['GCP', state.summary.byProvider.gcp],
                ['OCI', state.summary.byProvider.oci],
              ].map(([label, value]) => (
                <div key={label} style={{
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '10px 14px', minWidth: 80,
                }}>
                  <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                placeholder="Search name or email…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border-strong)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, flex: 1, minWidth: 180 }}
              />
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border-strong)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13 }}>
                <option value="">All statuses</option>
                <option value="pending_confirmation">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="unsubscribed">Unsubscribed</option>
              </select>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border-strong)', background: 'var(--bg)', color: 'var(--ink)', fontSize: 13 }}>
                <option value="">All providers</option>
                <option value="aws">AWS</option>
                <option value="azure">Azure</option>
                <option value="gcp">GCP</option>
                <option value="oci">OCI</option>
              </select>
              <button onClick={load} style={buttonStyle}>Refresh</button>
              <button onClick={exportCsv} style={buttonStyle}>Export CSV</button>
              <button onClick={signOut} style={buttonStyle}>Sign out</button>
            </div>

            {actionError && <div style={{ fontSize: 13, color: 'var(--red-text)', marginBottom: 10 }}>{actionError}</div>}

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--chip-bg)' }}>
                    <th style={{ ...cellStyle, textAlign: 'left' }}>Name</th>
                    <th style={{ ...cellStyle, textAlign: 'left' }}>Email</th>
                    <th style={{ ...cellStyle, textAlign: 'left' }}>Providers</th>
                    <th style={{ ...cellStyle, textAlign: 'left' }}>Status</th>
                    <th style={{ ...cellStyle, textAlign: 'left' }}>Created</th>
                    <th style={{ ...cellStyle, textAlign: 'left' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {state.subscribers.map((s) => (
                    <tr key={s.id}>
                      <td style={cellStyle}>{s.name}</td>
                      <td style={cellStyle}>{s.email}</td>
                      <td style={cellStyle}>
                        {s.providers.join(', ')}
                        {s.pending_providers && (
                          <span style={{ color: 'var(--amber)' }}> (pending: {s.pending_providers.join(', ')})</span>
                        )}
                      </td>
                      <td style={cellStyle}>{s.status}</td>
                      <td style={cellStyle}>{new Date(s.created_at).toLocaleDateString()}</td>
                      <td style={cellStyle}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {s.status === 'pending_confirmation' && (
                            <button style={buttonStyle} onClick={() => runAction(s.id, 'resend_confirmation')}>Resend</button>
                          )}
                          {s.status !== 'unsubscribed' && (
                            <button style={buttonStyle} onClick={() => runAction(s.id, 'force_unsubscribe')}>Unsubscribe</button>
                          )}
                          <button
                            style={{ ...buttonStyle, color: 'var(--red-text)' }}
                            onClick={() => {
                              if (window.confirm(`Delete ${s.email}? This can't be undone.`)) {
                                runAction(s.id, 'delete');
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {state.subscribers.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ ...cellStyle, textAlign: 'center', color: 'var(--ink-3)' }}>
                        No subscribers match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
