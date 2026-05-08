import type { Provider } from '../types/status';

interface Props {
  provider: Provider;
  error: string;
}

const providerNames: Record<Provider, string> = {
  aws: 'Amazon Web Services',
  azure: 'Microsoft Azure',
  gcp: 'Google Cloud',
  oci: 'Oracle Cloud',
};

export function ErrorState({ provider, error }: Props) {
  return (
    <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/30 p-4">
      <p className="text-sm font-semibold text-red-600 dark:text-red-400">{providerNames[provider]}</p>
      <p className="mt-1 text-xs text-red-500 dark:text-red-300/70">Unable to fetch status data</p>
      <p className="mt-2 text-xs text-gray-500 font-mono break-all">{error}</p>
    </div>
  );
}
