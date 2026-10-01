import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { RunHistoryPanel } from './admin/RunHistoryPanel';
import { AnalysisSettingsPanel } from './admin/AnalysisSettingsPanel';

type AdminTab = 'subscribers' | 'runs' | 'settings';

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

interface DeleteTarget {
  ids: string[];
  label: string;
}

type TestEmailType = 'confirmation' | 'update_confirmation' | 'welcome' | 'outage' | 'resolution';

const TEST_EMAIL_TYPES: { value: TestEmailType; label: string; needsProvider: boolean }[] = [
  { value: 'confirmation', label: 'Confirm subscription', needsProvider: false },
  { value: 'update_confirmation', label: 'Confirm changes', needsProvider: false },
  { value: 'welcome', label: "You're subscribed", needsProvider: false },
  { value: 'outage', label: 'Incident started', needsProvider: true },
  { value: 'resolution', label: 'Incident resolved', needsProvider: true },
];

const cellStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderTop: '1px solid var(--border)' };
const linkStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border-strong)',
  background: 'var(--card)', color: 'var(--ink-2)', fontSize: 12.5, cursor: 'pointer',
  fontFamily: 'inherit', textDecoration: 'none', display: 'inline-block', whiteSpace: 'nowrap',
};
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none',
  background: 'var(--card)', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const fieldStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border-strong)',
  background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, width: '100%', fontFamily: 'inherit',
  boxSizing: 'border-box',
};
const fieldLabelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 };

const APP_URL = 'https://cloudstatus.synepho.com';
const VERCEL_PROJECT_URL = 'https://vercel.com/johns-projects-2d2073fd/csp-status-hub';
const NEON_PROJECT_URL = 'https://console.neon.tech/app/projects/misty-truth-00063689';
// Upstash Redis is provisioned via the Vercel Marketplace (store: upstash-kv-orange-ball),
// not a standalone Upstash account, so it's managed from the project's Storage tab rather
// than console.upstash.com — see README.md's Alerts & Admin section.
const REDIS_STORE_URL = `${VERCEL_PROJECT_URL}/stores`;

const opsLinkGroups: { label: string; links: { label: string; href: string }[] }[] = [
  {
    label: 'Vercel',
    links: [
      { label: 'Cron Jobs →', href: `${VERCEL_PROJECT_URL}/settings/cron-jobs` },
      { label: 'Runtime Logs →', href: `${VERCEL_PROJECT_URL}/logs` },
      { label: 'Deployments →', href: `${VERCEL_PROJECT_URL}/deployments` },
    ],
  },
  {
    label: 'Neon',
    links: [{ label: 'Console →', href: NEON_PROJECT_URL }],
  },
  {
    label: 'Redis',
    links: [{ label: 'Storage →', href: REDIS_STORE_URL }],
  },
  {
    label: 'Resend',
    links: [
      { label: 'Emails →', href: 'https://resend.com/emails' },
      { label: 'Domains →', href: 'https://resend.com/domains' },
    ],
  },
  {
    label: 'AWS',
    links: [{ label: 'EventBridge →', href: 'https://600424110307.signin.aws.amazon.com/console' }],
  },
];

function subscriberPill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'confirmed': return { cls: 'pill ok', label: 'Confirmed' };
    case 'pending_confirmation': return { cls: 'pill warn', label: 'Pending' };
    case 'unsubscribed': return { cls: 'pill muted', label: 'Unsubscribed' };
    default: return { cls: 'pill muted', label: status };
  }
}

export function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('subscribers');
  const [state, setState] = useState<PageState>({ kind: 'loading' });
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  const [actionError, setActionError] = useState('');
  const [linksOpen, setLinksOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null);
  const [testEmailOpen, setTestEmailOpen] = useState(false);
  const [testEmailType, setTestEmailType] = useState<TestEmailType>('outage');
  const [testEmailProvider, setTestEmailProvider] = useState('aws');
  const [testEmailTo, setTestEmailTo] = useState('');
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [testEmailResult, setTestEmailResult] = useState<{ ok: boolean; message: string } | null>(null);

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
        if (data) {
          setState({ kind: 'ready', summary: data.summary, subscribers: data.subscribers });
          setSelected(new Set());
        }
      })
      .catch(() => setState({ kind: 'signed-out' }));
  }, [status, provider, search]);

  useEffect(() => {
    const id = setTimeout(() => load(), 200);
    return () => clearTimeout(id);
  }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Element;
      if (!target.closest('[data-quick-links-root]')) setLinksOpen(false);
      if (!target.closest('[data-row-menu-root]')) {
        setOpenMenuId(null);
        setMenuPos(null);
      }
    }
    // The row menu is portaled with fixed positioning computed at open time, so
    // it doesn't move with the row if the page scrolls — close it rather than
    // let it drift away from its trigger button.
    function closeRowMenuOnScroll() {
      setOpenMenuId(null);
      setMenuPos(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', closeRowMenuOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', closeRowMenuOnScroll, true);
    };
  }, []);

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

  async function bulkUnsubscribe() {
    const ids = Array.from(selected);
    await Promise.all(ids.map((id) => runAction(id, 'force_unsubscribe')));
  }

  function requestDelete(ids: string[], label: string) {
    setOpenMenuId(null);
    setConfirmDelete({ ids, label });
  }

  async function confirmDeleteAction() {
    if (!confirmDelete) return;
    const ids = confirmDelete.ids;
    setConfirmDelete(null);
    await Promise.all(ids.map((id) => runAction(id, 'delete')));
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (state.kind !== 'ready') return;
    const allSelected = state.subscribers.length > 0 && state.subscribers.every((s) => selected.has(s.id));
    setSelected(allSelected ? new Set() : new Set(state.subscribers.map((s) => s.id)));
  }

  function exportCsv() {
    const params = new URLSearchParams({ format: 'csv' });
    if (status) params.set('status', status);
    if (provider) params.set('provider', provider);
    if (search) params.set('q', search);
    window.location.href = `/api/admin/subscribers?${params.toString()}`;
  }

  async function sendTestEmail() {
    setTestEmailSending(true);
    setTestEmailResult(null);
    try {
      const res = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: testEmailType, to: testEmailTo, provider: testEmailProvider }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Send failed');
      setTestEmailResult({ ok: true, message: body.message ?? 'Sent' });
      setTestEmailTo('');
    } catch (err) {
      setTestEmailResult({ ok: false, message: err instanceof Error ? err.message : 'Send failed' });
    } finally {
      setTestEmailSending(false);
    }
  }

  function openTestEmailFor(s: Subscriber) {
    setOpenMenuId(null);
    setTestEmailResult(null);
    setTestEmailTo(s.email);
    const specificProvider = s.providers.find((p) => p !== 'all');
    if (specificProvider) setTestEmailProvider(specificProvider);
    setTestEmailOpen(true);
  }

  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST' });
    setState({ kind: 'signed-out' });
  }

  const confirmedSubscribers = state.kind === 'ready' ? state.subscribers.filter((s) => s.status === 'confirmed') : [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '32px 24px', fontFamily: 'inherit' }}>
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
            Cloud Status Hub — Admin
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <a
              href={APP_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border-strong)',
                background: 'var(--ink)', color: 'var(--bg)', fontSize: 13, fontWeight: 500,
                textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Open App ↗
            </a>
            <button className="btn-ghost" onClick={() => { setTestEmailResult(null); setTestEmailTo(''); setTestEmailOpen(true); }}>
              Send test email
            </button>
            <div style={{ position: 'relative' }} data-quick-links-root>
              <button className="btn-ghost" onClick={() => setLinksOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                Quick links <span style={{ fontSize: 10 }}>▾</span>
              </button>
              {linksOpen && (
                <div style={{
                  position: 'absolute', right: 0, top: 40, background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 14, width: 260, zIndex: 10,
                }}>
                  {opsLinkGroups.map((group) => (
                    <div key={group.label} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--ink-3)', marginBottom: 6, textTransform: 'uppercase' }}>
                        {group.label}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {group.links.map((link) => (
                          <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                            {link.label}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

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
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button
                className="btn-ghost"
                style={activeTab === 'subscribers' ? { background: 'var(--ink)', color: 'var(--bg)' } : undefined}
                onClick={() => setActiveTab('subscribers')}
              >
                Subscribers
              </button>
              <button
                className="btn-ghost"
                style={activeTab === 'runs' ? { background: 'var(--ink)', color: 'var(--bg)' } : undefined}
                onClick={() => setActiveTab('runs')}
              >
                AI Run History
              </button>
              <button
                className="btn-ghost"
                style={activeTab === 'settings' ? { background: 'var(--ink)', color: 'var(--bg)' } : undefined}
                onClick={() => setActiveTab('settings')}
              >
                AI Settings
              </button>
            </div>

            {activeTab === 'runs' && <RunHistoryPanel />}
            {activeTab === 'settings' && <AnalysisSettingsPanel />}
          </>
        )}

        {state.kind === 'ready' && activeTab === 'subscribers' && (
          <>
            <div style={{
              display: 'flex', alignItems: 'center', background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '12px 4px', marginBottom: 20, overflowX: 'auto',
            }}>
              {([
                ['Total', state.summary.total, 'var(--ink)'],
                ['Confirmed', state.summary.confirmed, 'var(--green-text)'],
                ['Pending', state.summary.pending, 'var(--amber)'],
                ['Unsubscribed', state.summary.unsubscribed, 'var(--ink-3)'],
                ['AWS', state.summary.byProvider.aws, 'var(--ink-2)'],
                ['Azure', state.summary.byProvider.azure, 'var(--ink-2)'],
                ['GCP', state.summary.byProvider.gcp, 'var(--ink-2)'],
                ['OCI', state.summary.byProvider.oci, 'var(--ink-2)'],
              ] as [string, number, string][]).map(([label, value, color], i, arr) => (
                <div
                  key={label}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 6, padding: '0 16px', whiteSpace: 'nowrap',
                    borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{label}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flex: 1, flexWrap: 'wrap' }}>
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
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{state.subscribers.length} results</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn-ghost" onClick={load}>Refresh</button>
                <button className="btn-ghost" onClick={exportCsv}>Export CSV</button>
                <div style={{ width: 1, height: 20, background: 'var(--border-strong)' }} />
                <button className="btn-ghost" onClick={signOut}>Sign out</button>
              </div>
            </div>

            {actionError && <div style={{ fontSize: 13, color: 'var(--red-text)', marginBottom: 10 }}>{actionError}</div>}

            {selected.size > 0 && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'var(--chip-bg)', border: '1px solid var(--border-strong)', borderRadius: 8,
                padding: '10px 16px', marginBottom: 12,
              }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{selected.size} selected</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-ghost" onClick={bulkUnsubscribe}>Unsubscribe</button>
                  <button
                    className="btn-ghost"
                    style={{ color: 'var(--red-text)' }}
                    onClick={() => requestDelete(Array.from(selected), `${selected.size} subscriber${selected.size === 1 ? '' : 's'}`)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}

            <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--chip-bg)' }}>
                    <th style={{ ...cellStyle, borderTop: 'none', width: 32 }}>
                      <input
                        type="checkbox"
                        checked={state.subscribers.length > 0 && state.subscribers.every((s) => selected.has(s.id))}
                        onChange={toggleSelectAll}
                        style={{ width: 15, height: 15 }}
                      />
                    </th>
                    <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Name</th>
                    <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Email</th>
                    <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Providers</th>
                    <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Status</th>
                    <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Created</th>
                    <th style={{ ...cellStyle, borderTop: 'none', width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {state.subscribers.map((s) => {
                    const pill = subscriberPill(s.status);
                    const hasOtherActions = s.status !== 'unsubscribed';
                    return (
                      <tr key={s.id}>
                        <td style={cellStyle}>
                          <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelected(s.id)} style={{ width: 15, height: 15 }} />
                        </td>
                        <td style={cellStyle}>{s.name}</td>
                        <td style={cellStyle}>{s.email}</td>
                        <td style={cellStyle}>
                          {s.providers.join(', ')}
                          {s.pending_providers && (
                            <span style={{ color: 'var(--amber)' }}> (pending: {s.pending_providers.join(', ')})</span>
                          )}
                        </td>
                        <td style={cellStyle}>
                          <span className={pill.cls}>
                            <span className="dot" />
                            {pill.label}
                          </span>
                        </td>
                        <td style={cellStyle}>{new Date(s.created_at).toLocaleDateString()}</td>
                        <td style={{ ...cellStyle, position: 'relative' }} data-row-menu-root>
                          <button
                            className="icon-btn"
                            onClick={(e) => {
                              if (openMenuId === s.id) {
                                setOpenMenuId(null);
                                setMenuPos(null);
                                return;
                              }
                              const rect = e.currentTarget.getBoundingClientRect();
                              setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
                              setOpenMenuId(s.id);
                            }}
                          >
                            ⋯
                          </button>
                          {openMenuId === s.id && menuPos && createPortal(
                            <div
                              data-row-menu-root
                              style={{
                                position: 'fixed', top: menuPos.top, right: menuPos.right, background: 'var(--card)', border: '1px solid var(--border)',
                                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', zIndex: 1000, overflow: 'hidden', minWidth: 170,
                              }}
                            >
                              {s.status === 'pending_confirmation' && (
                                <button style={menuItemStyle} onClick={() => { setOpenMenuId(null); setMenuPos(null); runAction(s.id, 'resend_confirmation'); }}>
                                  Resend confirmation
                                </button>
                              )}
                              {s.status !== 'unsubscribed' && (
                                <button style={menuItemStyle} onClick={() => { setOpenMenuId(null); setMenuPos(null); runAction(s.id, 'force_unsubscribe'); }}>
                                  Unsubscribe
                                </button>
                              )}
                              {s.status === 'confirmed' && (
                                <button style={menuItemStyle} onClick={() => { setMenuPos(null); openTestEmailFor(s); }}>
                                  Send test email
                                </button>
                              )}
                              <button
                                style={{ ...menuItemStyle, color: 'var(--red-text)', borderTop: hasOtherActions ? '1px solid var(--border)' : 'none' }}
                                onClick={() => { setMenuPos(null); requestDelete([s.id], s.email); }}
                              >
                                Delete
                              </button>
                            </div>,
                            document.body
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {state.subscribers.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ ...cellStyle, textAlign: 'center', color: 'var(--ink-3)' }}>
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

      {confirmDelete && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => setConfirmDelete(null)}
        >
          <div
            style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
              padding: '26px 28px', width: 380, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: 'var(--ink)' }}>
              Delete {confirmDelete.ids.length === 1 ? 'subscriber' : 'subscribers'}?
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 20 }}>
              This removes {confirmDelete.label} permanently. This can't be undone.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                style={{
                  padding: '9px 16px', borderRadius: 8, border: 'none', background: 'var(--red)',
                  color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
                onClick={confirmDeleteAction}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {testEmailOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => setTestEmailOpen(false)}
        >
          <div
            style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
              padding: '26px 28px', width: 380, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4, color: 'var(--ink)' }}>
              Send test email
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 18, lineHeight: 1.4 }}>
              Sends a real email via Resend using sample data — for previewing templates offline.
            </div>

            <label style={fieldLabelStyle}>Template</label>
            <select
              value={testEmailType}
              onChange={(e) => setTestEmailType(e.target.value as TestEmailType)}
              style={{ ...fieldStyle, marginBottom: 12 }}
            >
              {TEST_EMAIL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>

            {TEST_EMAIL_TYPES.find((t) => t.value === testEmailType)?.needsProvider && (
              <>
                <label style={fieldLabelStyle}>Provider</label>
                <select
                  value={testEmailProvider}
                  onChange={(e) => setTestEmailProvider(e.target.value)}
                  style={{ ...fieldStyle, marginBottom: 12 }}
                >
                  <option value="aws">AWS</option>
                  <option value="azure">Azure</option>
                  <option value="gcp">GCP</option>
                  <option value="oci">OCI</option>
                </select>
              </>
            )}

            <label style={fieldLabelStyle}>Send to</label>
            <select
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              style={{ ...fieldStyle, marginBottom: 14 }}
            >
              <option value="">Select a confirmed subscriber…</option>
              {confirmedSubscribers.map((s) => (
                <option key={s.id} value={s.email}>{s.name} — {s.email}</option>
              ))}
            </select>

            {testEmailResult && (
              <div style={{ fontSize: 13, color: testEmailResult.ok ? 'var(--green-text)' : 'var(--red-text)', marginBottom: 14 }}>
                {testEmailResult.message}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn-ghost" onClick={() => setTestEmailOpen(false)}>Close</button>
              <button
                disabled={!testEmailTo || testEmailSending}
                style={{
                  padding: '9px 16px', borderRadius: 8, border: 'none', background: 'var(--ink)',
                  color: 'var(--bg)', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  opacity: !testEmailTo || testEmailSending ? 0.5 : 1,
                }}
                onClick={sendTestEmail}
              >
                {testEmailSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
