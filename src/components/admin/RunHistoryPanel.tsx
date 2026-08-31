import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface AnalysisRun {
  id: string;
  provider: string;
  incident_id: string;
  incident_title: string | null;
  trigger_event: string;
  status: string;
  error: string | null;
  model: string;
  created_at: string;
  pdf_technical_url: string | null;
  pdf_executive_url: string | null;
}

const cellStyle: React.CSSProperties = { padding: '10px 12px', fontSize: 13, borderTop: '1px solid var(--border)' };
const menuItemStyle: React.CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', padding: '9px 14px', border: 'none',
  background: 'var(--card)', color: 'var(--ink)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
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

const TRIGGER_LABELS: Record<string, string> = { new: 'New', content_changed: 'Updated', resolved: 'Resolved' };

export function RunHistoryPanel() {
  const [runs, setRuns] = useState<AnalysisRun[] | null>(null);
  const [providerFilter, setProviderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionError, setActionError] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/admin/analysis-admin?resource=runs')
      .then((res) => res.json())
      .then((data) => setRuns(data.runs ?? []))
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
    setRetryingId(id);
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
      setRetryingId(null);
    }
  }

  if (runs === null) return <div style={{ color: 'var(--ink-2)', fontSize: 14 }}>Loading…</div>;

  const filtered = runs.filter((r) => {
    if (providerFilter && r.provider !== providerFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
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
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{filtered.length} results</span>
        </div>
        <button className="btn-ghost" onClick={load}>Refresh</button>
      </div>

      {actionError && <div style={{ fontSize: 13, color: 'var(--red-text)', marginBottom: 10 }}>{actionError}</div>}

      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--chip-bg)' }}>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Provider</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Incident</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Trigger</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Status</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Model</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>Created</th>
              <th style={{ ...cellStyle, borderTop: 'none', textAlign: 'left' }}>PDF</th>
              <th style={{ ...cellStyle, borderTop: 'none', width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const pill = statusPill(r.status);
              return (
                <tr key={r.id} style={{ opacity: retryingId === r.id ? 0.5 : 1 }}>
                  <td style={cellStyle}>{r.provider.toUpperCase()}</td>
                  <td style={cellStyle} title={r.error ?? undefined}>{r.incident_title ?? r.incident_id}</td>
                  <td style={cellStyle}>{TRIGGER_LABELS[r.trigger_event] ?? r.trigger_event}</td>
                  <td style={cellStyle}>
                    <span className={pill.cls}><span className="dot" />{pill.label}</span>
                  </td>
                  <td style={cellStyle}>{r.model}</td>
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
                      disabled={retryingId === r.id}
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
                      </div>,
                      document.body
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ ...cellStyle, textAlign: 'center', color: 'var(--ink-3)' }}>
                  No analysis runs match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
