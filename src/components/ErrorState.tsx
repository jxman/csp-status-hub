import type { Provider } from '../types/status';

interface Props {
  provider: Provider;
  error: string;
  sourceUrl?: string;
}

const providerNames: Record<Provider, string> = {
  aws: 'Amazon Web Services',
  azure: 'Microsoft Azure',
  gcp: 'Google Cloud',
  oci: 'Oracle Cloud',
};

const officialUrls: Record<Provider, string> = {
  aws: 'https://status.aws.amazon.com/',
  azure: 'https://azure.status.microsoft/',
  gcp: 'https://status.cloud.google.com/',
  oci: 'https://ocistatus.oraclecloud.com/',
};

function friendlyMessage(error: string): string {
  if (error.includes('vercel dev')) return 'The Azure proxy function is not running in this environment.';
  const lower = error.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Could not connect to the status feed. Check your network connection.';
  }
  if (/proxy returned \d{3}|fetch failed: \d{3}/.test(lower)) {
    return 'The status feed returned an error response. This may be a temporary issue.';
  }
  if (lower.includes('unexpected html') || lower.includes('parse') || lower.includes('json')) {
    return 'Received an unexpected response from the status feed.';
  }
  return 'Unable to load status data. This may be a temporary issue.';
}

export function ErrorState({ provider, error, sourceUrl }: Props) {
  const officialUrl = sourceUrl || officialUrls[provider];
  const isLocalDevAzure = provider === 'azure' && error.includes('vercel dev');

  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">{providerNames[provider]}</p>
        <p className="mt-0.5 text-xs text-red-500 dark:text-red-300/80">{friendlyMessage(error)}</p>
      </div>

      {isLocalDevAzure && (
        <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 px-3 py-2">
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Azure data is served via a Vercel serverless function which only runs under{' '}
            <code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 rounded">vercel dev</code>.
            Switch from <code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 rounded">npm run dev</code> to{' '}
            <code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 rounded">vercel dev</code> to test it locally.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <details className="flex-1 min-w-0 group">
          <summary className="text-xs text-gray-400 dark:text-gray-600 cursor-pointer hover:text-gray-500 dark:hover:text-gray-500 select-none list-none flex items-center gap-1">
            <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            Error details
          </summary>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500 font-mono break-all leading-relaxed">{error}</p>
        </details>

        <a
          href={officialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors whitespace-nowrap"
        >
          Official status page →
        </a>
      </div>
    </div>
  );
}
