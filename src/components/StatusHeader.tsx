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

  // Tick every second while there is an active cooldown to drive the countdown
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

  let buttonLabel: string;
  let buttonTitle: string;
  if (!isOnline) {
    buttonLabel = 'Offline';
    buttonTitle = 'No network connection';
  } else if (isRefreshing) {
    buttonLabel = 'Refreshing…';
    buttonTitle = 'Fetching latest status…';
  } else if (onCooldown) {
    buttonLabel = `Refresh (${secondsLeft}s)`;
    buttonTitle = `Available in ${secondsLeft} seconds`;
  } else {
    buttonLabel = 'Refresh Now';
    buttonTitle = 'Fetch latest status from all providers';
  }

  return (
    <header className="flex items-center justify-between px-6 py-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
        <h1 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">Cloud Status Hub</h1>
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wider">
          {isOnline ? 'Live' : 'Offline'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        {lastRefreshedAt && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Refreshed {formatRelative(lastRefreshedAt)}
          </span>
        )}

        <button
          onClick={onRefresh}
          disabled={!canRefresh}
          title={buttonTitle}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium
            bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600
            text-gray-700 dark:text-white
            disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isRefreshing && (
            <span className="inline-block w-3.5 h-3.5 border-2 border-gray-400 border-t-gray-700 dark:border-white/30 dark:border-t-white rounded-full animate-spin" />
          )}
          {buttonLabel}
        </button>

        <button
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-1.5 rounded-md text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-white
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
    </header>
  );
}
