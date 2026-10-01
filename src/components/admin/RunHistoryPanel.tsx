import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface AnalysisRun {
  id: string;
  provider: string;
  incident_id: string;
  incident_title: string | null;
  affected_regions: string[] | null;
  trigger_event: string;
  status: string;
  error: string | null;
  model: string;
  created_at: string;
  pdf_technical_url: string | null;
  pdf_executive_url: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  link: LinkKind;
  link_until: string | null;
}

type ConfirmState =
  | { kind: 'single'; id: string; label: string; linked: boolean }
  | { kind: 'bulk' };

const cellStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderTop: '1px solid var(--border)' };
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none',
  background: 'var(--card)', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const menuItemDangerStyle: React.CSSProperties = { ...menuItemStyle, color: 'var(--red-text)' };
const selectStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border-strong)',
  background: 'var(--bg)', color: 'var(--ink)', fontSize: 13,
};

// PDF links go through the admin endpoint by run id (it redirects to the
// Vercel Blob URL after checking it server-side), so stored URLs never reach
// an href here.
function pdfHref(runId: string, kind: 'technical' | 'executive'): string {
  return `/api/admin/analysis-admin?resource=pdf&kind=${kind}&id=${encodeURIComponent(runId)}`;
}

function statusPill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'complete': return { cls: 'pill ok', label: 'Complete' };
    case 'failed': return { cls: 'pill bad', label: 'Failed' };
    case 'pending': return { cls: 'pill warn', label: 'Pending' };
    default: return { cls: 'pill muted', label: status };
  }
}

// Per-run retention classification from api/_lib/runRetention.ts (the
// server is the single source of truth — the cleanup uses the same query).
type LinkKind =
  | 'active' | 'past' | 'recent' | 'replacing' | 'failed_kept'
  | 'superseded' | 'failed_resolved' | 'unlinked';

const DELETABLE: LinkKind[] = ['superseded', 'failed_resolved', 'unlinked'];

function isLinked(r: AnalysisRun): boolean {
  return r.link === 'active' || r.link === 'past' || r.link === 'recent';
}

function isDeletable(r: AnalysisRun): boolean {
  return DELETABLE.includes(r.link);
}

function linkBadge(r: AnalysisRun, opts: { retentionDays: number; failedRetentionDays: number; supersededGrace: string }) {
  switch (r.link) {
    case 'active':
      return { cls: 'pill ok', label: 'Active', title: 'Latest brief for an incident on the live dashboard' };
    case 'past': {
      const until = r.link_until ? new Date(r.link_until) : null;
      return {
        cls: 'pill info',
        label: until ? `Past · until ${until.toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'Past',
        title: `Latest brief, linked from Past incidents for ${opts.retentionDays} days after it resolved`,
      };
    }
    case 'recent':
      return { cls: 'pill info', label: 'Recent', title: 'Latest brief for an incident with a run in the last 24h — kept while it may still show under Recently resolved' };
    case 'replacing':
      return { cls: 'pill muted', label: 'Superseded · grace', title: `Replaced by a newer brief less than ${opts.supersededGrace} ago — kept while edge caches may still link to it` };
    case 'superseded':
      return { cls: 'pill muted', label: 'Superseded', title: 'A newer brief replaced this one; the dashboard no longer links to it' };
    case 'failed_kept':
      return { cls: 'pill warn', label: 'Failed · kept', title: `No successful run since — kept for up to ${opts.failedRetentionDays} days for its error message` };
    case 'failed_resolved':
      return { cls: 'pill muted', label: 'Failed · resolved', title: `A later run succeeded, or older than ${opts.failedRetentionDays} days` };
    default:
      return { cls: 'pill muted', label: 'Unlinked', title: 'The dashboard no longer links to this incident' };
  }
}

const TRIGGER_LABELS: Record<string, string> = { new: 'New', content_changed: 'Updated', resolved: 'Resolved' };

// Bedrock's actual reported usage for this run (response.usage.inputTokens /
// outputTokens, written by api/_lib/analysisPipeline.ts) — null for any row
// from before that column existed, or if usage was missing on the response.
function formatTokens(r: AnalysisRun): string {
  if (r.input_tokens == null && r.output_tokens == null) return '—';
  const inT = r.input_tokens != null ? r.input_tokens.toLocaleString() : '—';
  const outT = r.output_tokens != null ? r.output_tokens.toLocaleString() : '—';
  return `${inT} in / ${outT} out`;
}

export function RunHistoryPanel() {
  const [runs, setRuns] = useState<AnalysisRun[] | null>(null);
  const [deletableCount, setDeletableCount] = useState(0);
  const [retentionDays, setRetentionDays] = useState(90);
  const [failedRetentionDays, setFailedRetentionDays] = useState(30);
  const [supersededGrace, setSupersededGrace] = useState('2 hours');
  const [activeConfirmed, setActiveConfirmed] = useState(false);
  const [activeReason, setActiveReason] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [actionError, setActionError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/analysis-admin?resource=runs')
      .then((res) => res.json())
      .then((data) => {
        setRuns(data.runs ?? []);
        setDeletableCount(data.deletableCount ?? 0);
        if (typeof data.retentionDays === 'number') setRetentionDays(data.retentionDays);
        if (typeof data.failedRetentionDays === 'number') setFailedRetentionDays(data.failedRetentionDays);
        if (typeof data.supersededGrace === 'string') setSupersededGrace(data.supersededGrace);
        setActiveConfirmed(!!data.activeConfirmed);
        setActiveReason(data.activeReason ?? null);
      })
      .catch(() => setActionError('Failed to load run history'));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Element;
      if (!target.closest('[data-row-menu-root]')) {
        setOpenMenuId(null);
        setMenuPos(null);
      }
    }
    function closeOnScroll() {
      setOpenMenuId(null);
      setMenuPos(null);
    }
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, []);

  async function rerun(id: string) {
    setOpenMenuId(null);
    setMenuPos(null);
    setActionError('');
    setBusyId(id);
    try {
      const res = await fetch('/api/admin/analysis-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retry', id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Re-run failed');
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Re-run failed');
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRun(id: string) {
    setConfirmState(null);
    setActionError('');
    setBusyId(id);
    try {
      const res = await fetch('/api/admin/analysis-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_run', id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Delete failed');
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  }

  async function cleanupInactive() {
    setConfirmState(null);
    setActionError('');
    setBulkBusy(true);
    try {
      const res = await fetch('/api/admin/analysis-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup_inactive' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Cleanup failed');
      load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Cleanup failed');
    } finally {
      setBulkBusy(false);
    }
  }

  if (runs === null) return <div style={{ color: 'var(--ink-2)', fontSize: 14 }}>Loading…</div>;

  const filtered = runs.filter((r) => {
    if (providerFilter && r.provider !== providerFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (activeFilter === 'linked' && !isLinked(r)) return false;
    if (activeFilter === 'removable' && !isDeletable(r)) return false;
    return true;
  });

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} style={selectStyle}>
            <option value="">All providers</option>
            <option value="aws">AWS</option>
            <option value="azure">Azure</option>
            <option value="gcp">GCP</option>
            <option value="oci">OCI</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            <option value="complete">Complete</option>
            <option value="failed">Failed</option>
          </select>
          <select value={activeFilter} onChange={(e) => setActiveFilter(e.target.value)} style={selectStyle}>
            <option value="">All runs</option>
            <option value="linked">Linked from dashboard</option>
            <option value="removable">Removable by cleanup</option>
          </select>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{filtered.length} results</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn-ghost"
            disabled={!activeConfirmed || bulkBusy || deletableCount === 0}
            title={!activeConfirmed ? (activeReason ?? "Can't confirm active-incident state yet") : undefined}
            onClick={() => setConfirmState({ kind: 'bulk' })}
          >
            {bulkBusy ? 'Cleaning up…' : `Clean up unused${activeConfirmed && deletableCount > 0 ? ` (${deletableCount})` : ''}`}
          </button>
          <button className="btn-ghost" onClick={load}>Refresh</button>
        </div>
      </div>

      {!activeConfirmed && activeReason && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>
          Link state unavailable: {activeReason}
        </div>
      )}
      {actionError && <div style={{ fontSize: 13, color: 'var(--red-text)', marginBottom: 10 }}>{actionError}</div>}

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--chip-bg)' }}>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Provider</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Incident</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Link</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Trigger</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Status</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Model</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Tokens</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Created</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>PDF</th>
              <th style={{ ...cellStyle, borderTop: 'none', width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const pill = statusPill(r.status);
              const badge = linkBadge(r, { retentionDays, failedRetentionDays, supersededGrace });
              return (
                <tr key={r.id} style={{ opacity: busyId === r.id ? 0.5 : 1 }}>
                  <td style={cellStyle}>{r.provider.toUpperCase()}</td>
                  <td style={cellStyle} title={r.error ?? undefined}>
                    <div>{r.incident_title ?? r.incident_id}</div>
                    {r.affected_regions && r.affected_regions.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>
                        {r.affected_regions.join(', ')}
                      </div>
                    )}
                  </td>
                  <td style={cellStyle}>
                    {activeConfirmed
                      ? <span className={badge.cls} title={badge.title} style={{ whiteSpace: 'nowrap' }}><span className="dot" />{badge.label}</span>
                      : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                  </td>
                  <td style={cellStyle}>{TRIGGER_LABELS[r.trigger_event] ?? r.trigger_event}</td>
                  <td style={cellStyle}>
                    <span className={pill.cls}><span className="dot" />{pill.label}</span>
                  </td>
                  <td style={cellStyle}>{r.model}</td>
                  <td style={cellStyle}>{formatTokens(r)}</td>
                  <td style={cellStyle}>{new Date(r.created_at).toLocaleString()}</td>
                  <td style={cellStyle}>
                    {r.pdf_technical_url && (
                      <a href={pdfHref(r.id, 'technical')} target="_blank" rel="noopener noreferrer" style={{ marginRight: 8 }}>Tech</a>
                    )}
                    {r.pdf_executive_url && (
                      <a href={pdfHref(r.id, 'executive')} target="_blank" rel="noopener noreferrer">Exec</a>
                    )}
                  </td>
                  <td style={{ ...cellStyle, position: 'relative' }} data-row-menu-root>
                    <button
                      className="icon-btn"
                      disabled={busyId === r.id}
                      onClick={(e) => {
                        if (openMenuId === r.id) {
                          setOpenMenuId(null);
                          setMenuPos(null);
                          return;
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        setMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
                        setOpenMenuId(r.id);
                      }}
                    >
                      ⋯
                    </button>
                    {openMenuId === r.id && menuPos && createPortal(
                      <div
                        data-row-menu-root
                        style={{
                          position: 'fixed', top: menuPos.top, right: menuPos.right, background: 'var(--card)', border: '1px solid var(--border)',
                          borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', zIndex: 1000, overflow: 'hidden', minWidth: 130,
                        }}
                      >
                        <button style={menuItemStyle} onClick={() => rerun(r.id)}>Re-run</button>
                        <button
                          style={menuItemDangerStyle}
                          onClick={() => {
                            setOpenMenuId(null);
                            setMenuPos(null);
                            setConfirmState({ kind: 'single', id: r.id, label: r.incident_title ?? r.incident_id, linked: isLinked(r) });
                          }}
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
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ ...cellStyle, textAlign: 'center', color: 'var(--ink-3)' }}>
                  No analysis runs match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {confirmState && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
          }}
          onClick={() => setConfirmState(null)}
        >
          <div
            style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14,
              padding: '26px 28px', width: 420, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8, color: 'var(--ink)' }}>
              {confirmState.kind === 'single' ? 'Delete this run?' : `Clean up ${deletableCount} unused run${deletableCount === 1 ? '' : 's'}?`}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 20 }}>
              {confirmState.kind === 'single'
                ? <>
                    This permanently deletes the analysis run for <b>{confirmState.label}</b> and its PDFs. This can't be undone.
                    {confirmState.linked && (
                      <> <b>This incident is still linked from the dashboard</b> — if this is its latest brief, its AI Insight panel will stop working.</>
                    )}
                  </>
                : <>
                    This permanently deletes {deletableCount} analysis run{deletableCount === 1 ? '' : 's'} and their PDFs:
                    briefs replaced by a newer one more than {supersededGrace} ago, failed runs that were later retried
                    successfully or are over {failedRetentionDays} days old, and briefs for incidents the dashboard no longer
                    links to. The latest brief of every active incident, Past incident (resolved within {retentionDays} days),
                    and incident with a run in the last 24h is never touched. This can&apos;t be undone.
                  </>}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn-ghost" onClick={() => setConfirmState(null)}>Cancel</button>
              <button
                style={{
                  padding: '9px 16px', borderRadius: 8, border: 'none', background: 'var(--red)',
                  color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                }}
                onClick={() => confirmState.kind === 'single' ? deleteRun(confirmState.id) : cleanupInactive()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
