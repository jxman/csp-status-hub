import { useEffect, useState } from 'react';
import { formatRelative } from '../utils/formatters';

interface Props {
  lastRefreshedAt: string | null;
  onRefresh: () => void;
  isRefreshing: boolean;
  canRefresh: boolean;
  cooldownUntil: number;
  isOnline: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  );
}

export function StatusHeader({
  lastRefreshedAt,
  onRefresh,
  isRefreshing,
  canRefresh,
  cooldownUntil,
  isOnline,
  theme,
  onToggleTheme,
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

  // Full button label for desktop
  let desktopLabel: string;
  if (!isOnline) desktopLabel = 'Offline';
  else if (isRefreshing) desktopLabel = 'Refreshing…';
  else if (onCooldown) desktopLabel = `Refresh (${secondsLeft}s)`;
  else desktopLabel = 'Refresh Now';

  const buttonTitle = !isOnline
    ? 'No network connection'
    : isRefreshing
    ? 'Fetching latest status…'
    : onCooldown
    ? `Available in ${secondsLeft} seconds`
    : 'Fetch latest status from all providers';

  const onlineDot = (
    <div className={`w-2 h-2 rounded-full shrink-0 ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
  );

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">

      {/* ── Main row ── */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4">

        {/* Left: logo */}
        <div className="flex items-center gap-2.5">
          {onlineDot}
          <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white tracking-tight">
            Cloud Status Hub
          </h1>
          {/* "Live" badge — desktop only; shown in sub-row on mobile */}
          <span className="hidden sm:inline text-xs text-gray-400 font-medium uppercase tracking-wider">
            {isOnline ? 'Live' : 'Offline'}
          </span>
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-2">

          {/* "Refreshed X ago" — desktop only */}
          {lastRefreshedAt && (
            <span className="hidden sm:block text-sm text-gray-500 dark:text-gray-400">
              Refreshed {formatRelative(lastRefreshedAt)}
            </span>
          )}

          {/* Refresh button — icon-only on mobile, full text on desktop */}
          <button
            onClick={onRefresh}
            disabled={!canRefresh}
            title={buttonTitle}
            className="flex items-center gap-2 rounded-md font-medium transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
              bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600
              text-gray-700 dark:text-white
              p-2 sm:px-3 sm:py-1.5 sm:text-sm"
          >
            {/* Mobile: icon or spinner only */}
            <span className="sm:hidden">
              {isRefreshing ? (
                <span className="inline-block w-4 h-4 border-2 border-gray-400 border-t-gray-700 dark:border-white/30 dark:border-t-white rounded-full animate-spin" />
              ) : onCooldown ? (
                <span className="text-xs font-semibold tabular-nums w-6 text-center inline-block">{secondsLeft}s</span>
              ) : (
                <RefreshIcon className="w-4 h-4" />
              )}
            </span>

            {/* Desktop: spinner + text */}
            <span className="hidden sm:flex items-center gap-2">
              {isRefreshing && (
                <span className="inline-block w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-700 dark:border-white/30 dark:border-t-white rounded-full animate-spin" />
              )}
              {desktopLabel}
            </span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white
              hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {theme === 'dark' ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Mobile sub-row: Live badge + last refreshed ── */}
      <div className="sm:hidden flex items-center justify-between px-4 pb-2.5 -mt-1">
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
          {isOnline ? 'Live' : 'Offline'}
        </span>
        {lastRefreshedAt && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Refreshed {formatRelative(lastRefreshedAt)}
          </span>
        )}
      </div>

    </header>
  );
}
