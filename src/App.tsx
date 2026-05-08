import { useStatusPolling } from './hooks/useStatusPolling';
import { useTheme } from './hooks/useTheme';
import { StatusHeader } from './components/StatusHeader';
import { ProviderGrid } from './components/ProviderGrid';
import { IncidentList } from './components/IncidentList';

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
  const { dashboard, isRefreshing, lastSuccessfulRefresh, manualRefresh } = useStatusPolling();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 transition-colors">
      <StatusHeader
        lastRefreshedAt={lastSuccessfulRefresh}
        onRefresh={manualRefresh}
        isRefreshing={isRefreshing}
        theme={theme}
        onToggleTheme={toggle}
      />

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
