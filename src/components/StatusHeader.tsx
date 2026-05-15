import { useEffect, useState } from 'react';

interface Props {
  lastRefreshedAt: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  canRefresh: boolean;
  cooldownUntil: number;
  isOnline: boolean;
  hasDegradedProvider: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onSubscribe: () => void;
}

const BellIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export function StatusHeader({
  onRefresh,
  isRefreshing,
  canRefresh,
  cooldownUntil,
  isOnline,
  hasDegradedProvider,
  theme,
  onToggleTheme,
  onSubscribe,
}: Props) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => {
      setTick((t) => t + 1);
      if (Date.now() >= cooldownUntil) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const secondsLeft = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  const onCooldown = !isRefreshing && secondsLeft > 0;

  let refreshLabel: string;
  if (!isOnline) refreshLabel = 'Offline';
  else if (isRefreshing) refreshLabel = 'Refreshing…';
  else refreshLabel = 'Refresh now';

  let countdownText: string;
  if (!isOnline) countdownText = 'Offline';
  else if (isRefreshing) countdownText = 'Refreshing…';
  else if (onCooldown) countdownText = `Auto-refresh in ${secondsLeft}s`;
  else countdownText = 'Auto-refresh in 60s';

  return (
    <header className="dash-head">
      <div className="brand">
        <span className={`brand-dot${hasDegradedProvider ? ' bad' : ''}`} />
        <span className="brand-name">Cloud Status Hub</span>
        <span className="brand-live">LIVE</span>
      </div>

      <div className="head-right">
        <span className="refresh">{countdownText}</span>
        <button
          className="btn-ghost"
          onClick={onRefresh}
          disabled={!canRefresh}
          title={!isOnline ? 'No network connection' : isRefreshing ? 'Fetching…' : 'Fetch latest status'}
        >
          {isRefreshing ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                display: 'inline-block', width: 11, height: 11,
                border: '2px solid var(--border-strong)',
                borderTopColor: 'var(--ink-3)',
                borderRadius: '50%', animation: 'spin 0.7s linear infinite',
              }} />
              Refreshing…
            </span>
          ) : refreshLabel}
        </button>
        <button
          className="icon-btn"
          onClick={onSubscribe}
          aria-label="Subscribe to alerts"
          title="Subscribe to alerts"
        >
          <BellIcon />
        </button>
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}
