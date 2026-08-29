import { useEffect, useState } from 'react';

interface SettingsResponse {
  debounce: { override: number | null; envDefault: number; effective: number };
  disabledProviders: string[];
}

const PROVIDERS = ['aws', 'azure', 'gcp', 'oci'] as const;
const PROVIDER_LABELS: Record<string, string> = { aws: 'AWS', azure: 'Azure', gcp: 'GCP', oci: 'OCI' };

const fieldStyle: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border-strong)',
  background: 'var(--bg)', color: 'var(--ink)', fontSize: 13, fontFamily: 'inherit', width: 100,
};
const cardStyle: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 20, marginBottom: 16,
};
const primaryBtnStyle: React.CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--ink)',
  color: 'var(--bg)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
};

export function AnalysisSettingsPanel() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [minutesInput, setMinutesInput] = useState('');
  const [disabled, setDisabled] = useState<Set<string>>(new Set());
  const [debounceSaving, setDebounceSaving] = useState(false);
  const [debounceMessage, setDebounceMessage] = useState('');
  const [providersSaving, setProvidersSaving] = useState(false);
  const [providersMessage, setProvidersMessage] = useState('');

  function load() {
    fetch('/api/admin/analysis-admin')
      .then((res) => res.json())
      .then((data: SettingsResponse) => {
        setSettings(data);
        setMinutesInput(String(data.debounce.override ?? data.debounce.envDefault));
        setDisabled(new Set(data.disabledProviders));
      });
  }

  useEffect(() => { load(); }, []);

  async function saveDebounce() {
    const minutes = Number(minutesInput);
    if (!Number.isFinite(minutes) || minutes < 0) {
      setDebounceMessage('Enter a non-negative number');
      return;
    }
    setDebounceSaving(true);
    setDebounceMessage('');
    try {
      const res = await fetch('/api/admin/analysis-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_debounce', minutes }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed');
      setDebounceMessage('Saved');
      load();
    } catch (err) {
      setDebounceMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setDebounceSaving(false);
    }
  }

  async function resetDebounce() {
    setDebounceSaving(true);
    setDebounceMessage('');
    try {
      const res = await fetch('/api/admin/analysis-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_debounce' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Reset failed');
      setDebounceMessage('Reset to default');
      load();
    } catch (err) {
      setDebounceMessage(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setDebounceSaving(false);
    }
  }

  function toggleProvider(p: string) {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function saveProviders() {
    setProvidersSaving(true);
    setProvidersMessage('');
    try {
      const res = await fetch('/api/admin/analysis-admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_disabled_providers', providers: [...disabled] }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Save failed');
      setProvidersMessage('Saved');
      load();
    } catch (err) {
      setProvidersMessage(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setProvidersSaving(false);
    }
  }

  if (!settings) return <div style={{ color: 'var(--ink-2)', fontSize: 14 }}>Loading…</div>;

  return (
    <>
      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>Re-run debounce</div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14, lineHeight: 1.5 }}>
          Minimum minutes between analysis runs for the same incident.{' '}
          {settings.debounce.override !== null
            ? `Currently overridden to ${settings.debounce.override} min (env default is ${settings.debounce.envDefault}).`
            : `Using the env default of ${settings.debounce.envDefault} min.`}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="number"
            min={0}
            value={minutesInput}
            onChange={(e) => setMinutesInput(e.target.value)}
            style={fieldStyle}
          />
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>minutes</span>
          <button style={primaryBtnStyle} disabled={debounceSaving} onClick={saveDebounce}>
            {debounceSaving ? 'Saving…' : 'Save'}
          </button>
          <button className="btn-ghost" disabled={debounceSaving} onClick={resetDebounce}>
            Reset to default
          </button>
          {debounceMessage && <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{debounceMessage}</span>}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--ink)' }}>Per-provider kill switch</div>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14, lineHeight: 1.5 }}>
          Pauses AI brief generation for a provider — outage/resolution emails keep sending normally regardless.
        </div>
        <div style={{ display: 'flex', gap: 18, marginBottom: 14, flexWrap: 'wrap' }}>
          {PROVIDERS.map((p) => (
            <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
              <input type="checkbox" checked={disabled.has(p)} onChange={() => toggleProvider(p)} style={{ width: 15, height: 15 }} />
              Analysis paused for {PROVIDER_LABELS[p]}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={primaryBtnStyle} disabled={providersSaving} onClick={saveProviders}>
            {providersSaving ? 'Saving…' : 'Save'}
          </button>
          {providersMessage && <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{providersMessage}</span>}
        </div>
      </div>
    </>
  );
}
