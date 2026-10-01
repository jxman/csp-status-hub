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

// PDF URLs come from our own Postgres rows (always written by
// api/_lib/pdf/render.ts as an https:// Vercel Blob URL), but this is an
// admin panel rendering DB content straight into an <a href>, so guard the
// scheme before trusting it rather than assuming the DB can never contain
// anything else (e.g. a javascript: URL).
function isSafeHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function statusPill(status: string): { cls: string; label: string } {
  switch (status) {
    case 'complete': return { cls: 'pill ok', label: 'Complete' };
    case 'failed': return { cls: 'pill bad', label: 'Failed' };
    case 'pending': return { cls: 'pill warn', label: 'Pending' };
    default: return { cls: 'pill muted', label: status };
  }
}

// Whether an incident's briefs are still reachable from the dashboard — see
// getPastIncidentLinks() in api/admin/analysis-admin.ts. Bulk cleanup only
// ever deletes 'unlinked' runs.
type LinkState =
  | { kind: 'active' }
  | { kind: 'past'; until: string }
  | { kind: 'recent' }
  | { kind: 'unlinked' };

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
  const [activeKeys, setActiveKeys] = useState<Set<string> | null>(null);
  const [pastUntil, setPastUntil] = useState<Record<string, string>>({});
  const [recentKeys, setRecentKeys] = useState<Set<string>>(new Set());
  const [retentionDays, setRetentionDays] = useState(90);
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
        setActiveKeys(new Set<string>(data.activeKeys ?? []));
        setPastUntil(data.pastUntil ?? {});
        setRecentKeys(new Set<string>(data.recentKeys ?? []));
        if (typeof data.retentionDays === 'number') setRetentionDays(data.retentionDays);
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

  // Same precedence as the server-side cleanup: active, then a past-incident
  // link, then the 24h recent-run safety net.
  function linkState(r: AnalysisRun): LinkState {
    const key = `${r.provider}:${r.incident_id}`;
    if (activeKeys?.has(key)) return { kind: 'active' };
    if (pastUntil[key]) return { kind: 'past', until: pastUntil[key] };
    if (recentKeys.has(key)) return { kind: 'recent' };
    return { kind: 'unlinked' };
  }

  function isLinked(r: AnalysisRun): boolean {
    return linkState(r).kind !== 'unlinked';
  }

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
    if (activeFilter === 'unlinked' && isLinked(r)) return false;
    return true;
  });

  // Cleanup acts on the whole table server-side, not just these 200 loaded rows —
  // this count is a floor ("at least this many"), stated as such in the confirm dialog.
  const unlinkedLoadedCount = activeConfirmed ? runs.filter((r) => !isLinked(r)).length : 0;

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
            <option value="">Linked + unlinked</option>
            <option value="linked">Linked from dashboard</option>
            <option value="unlinked">Unlinked only</option>
          </select>
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{filtered.length} results</span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            className="btn-ghost"
            disabled={!activeConfirmed || bulkBusy || unlinkedLoadedCount === 0}
            title={!activeConfirmed ? (activeReason ?? "Can't confirm active-incident state yet") : undefined}
            onClick={() => setConfirmState({ kind: 'bulk' })}
          >
            {bulkBusy ? 'Cleaning up…' : 'Clean up unlinked'}
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
              const link = linkState(r);
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
                    {!activeConfirmed ? (
                      <span style={{ color: 'var(--ink-4)' }}>—</span>
                    ) : link.kind === 'active' ? (
                      <span className="pill ok"><span className="dot" />Active</span>
                    ) : link.kind === 'past' ? (
                      <span
                        className="pill info"
                        title={`Linked from Past incidents until ${new Date(link.until).toLocaleDateString()} (${retentionDays} days after it resolved)`}
                      >
                        <span className="dot" />Past · until {new Date(link.until).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    ) : link.kind === 'recent' ? (
                      <span className="pill info" title="Had a run in the last 24h — kept while it may still show under Recently resolved">
                        <span className="dot" />Recent
                      </span>
                    ) : (
                      <span className="pill muted"><span className="dot" />Unlinked</span>
                    )}
                  </td>
                  <td style={cellStyle}>{TRIGGER_LABELS[r.trigger_event] ?? r.trigger_event}</td>
                  <td style={cellStyle}>
                    <span className={pill.cls}><span className="dot" />{pill.label}</span>
                  </td>
                  <td style={cellStyle}>{r.model}</td>
                  <td style={cellStyle}>{formatTokens(r)}</td>
                  <td style={cellStyle}>{new Date(r.created_at).toLocaleString()}</td>
                  <td style={cellStyle}>
                    {r.pdf_technical_url && isSafeHttpsUrl(r.pdf_technical_url) && (
                      <a href={r.pdf_technical_url} target="_blank" rel="noopener noreferrer" style={{ marginRight: 8 }}>Tech</a>
                    )}
                    {r.pdf_executive_url && isSafeHttpsUrl(r.pdf_executive_url) && (
                      <a href={r.pdf_executive_url} target="_blank" rel="noopener noreferrer">Exec</a>
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
              {confirmState.kind === 'single' ? 'Delete this run?' : 'Clean up all unlinked runs?'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, marginBottom: 20 }}>
              {confirmState.kind === 'single'
                ? <>
                    This permanently deletes the analysis run for <b>{confirmState.label}</b> and its PDFs. This can't be undone.
                    {confirmState.linked && (
                      <> <b>This incident is still linked from the dashboard</b> — if this is its latest brief, its AI Insight panel will stop working.</>
                    )}
                  </>
                : <>This permanently deletes every stored analysis run — and its PDFs — for an incident the dashboard no longer links to (at least {unlinkedLoadedCount} shown here; older unlinked runs beyond this 200-row view are included too). Runs for active incidents, incidents in Past incidents (resolved within {retentionDays} days), and incidents with a run in the last 24h are never touched. This can't be undone.</>}
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
