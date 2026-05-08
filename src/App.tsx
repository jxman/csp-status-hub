import { useStatusPolling } from './hooks/useStatusPolling';
import { useTheme } from './hooks/useTheme';
import { StatusHeader } from './components/StatusHeader';
import { ProviderGrid } from './components/ProviderGrid';
import { IncidentList } from './components/IncidentList';
import { formatRelative } from './utils/formatters';

function LoadingSkeleton() {
  return (
    <div className="px-6 pt-6">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40 p-5 animate-pulse">
            <div className="flex items-center justify-between">
              <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
              <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
            </div>
            <div className="mt-3 h-3 w-32 bg-gray-100 dark:bg-gray-700/60 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const {
    dashboard,
    isRefreshing,
    lastSuccessfulRefresh,
    lastFetchFailed,
    isOnline,
    canRefresh,
    cooldownUntil,
    manualRefresh,
  } = useStatusPolling();

  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
      <StatusHeader
        lastRefreshedAt={lastSuccessfulRefresh}
        onRefresh={manualRefresh}
        isRefreshing={isRefreshing}
        canRefresh={canRefresh}
        cooldownUntil={cooldownUntil}
        isOnline={isOnline}
        theme={theme}
        onToggleTheme={toggle}
      />

      {/* Offline banner */}
      {!isOnline && (
        <div className="px-3 sm:px-6 pt-3 sm:pt-4">
          <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/50 px-4 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M12 12h.01M8.464 15.536a5 5 0 010-7.072M5.636 18.364a9 9 0 010-12.728" />
            </svg>
            <div>
              <span className="text-sm font-medium text-red-700 dark:text-red-400">No network connection</span>
              <span className="text-sm text-red-600 dark:text-red-300/80">
                {' '}— auto-refresh paused
                {lastSuccessfulRefresh && `, showing data from ${formatRelative(lastSuccessfulRefresh)}`}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Stale data banner — last fetch failed but we still have data to show */}
      {isOnline && lastFetchFailed && dashboard && (
        <div className="px-3 sm:px-6 pt-3 sm:pt-4">
          <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800/40 px-4 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-yellow-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
            <span className="text-sm text-yellow-700 dark:text-yellow-400">
              Last refresh failed — showing data from {lastSuccessfulRefresh ? formatRelative(lastSuccessfulRefresh) : 'a previous session'}. Will retry automatically.
            </span>
          </div>
        </div>
      )}

      {!dashboard ? (
        <LoadingSkeleton />
      ) : (
        <>
          <ProviderGrid providers={dashboard.providers} />
          <IncidentList providers={dashboard.providers} />
          <footer className="mt-8 pb-6 px-6 text-xs text-gray-400 dark:text-gray-600 text-center">
            Data refreshes every 60 seconds · AWS feed TTL is 5 minutes · Times shown in local timezone
          </footer>
        </>
      )}
    </div>
  );
}
