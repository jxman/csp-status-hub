import type { ProviderStatus } from '../types/status';

const AZURE_PROXY_URL = '/api/status/azure';
const AZURE_DASHBOARD_URL = 'https://azure.status.microsoft/';

export async function fetchAzure(): Promise<ProviderStatus> {
  const fetchedAt = new Date().toISOString();

  const response = await fetch(AZURE_PROXY_URL);
  if (!response.ok) {
    throw new Error(`Azure proxy returned ${response.status} ${response.statusText}`);
  }

  // Vite dev server returns index.html (200 OK) for unknown /api/* routes.
  // Detect this before calling .json() to avoid a cryptic parse error.
  const text = await response.text();
  if (text.trimStart().startsWith('<')) {
    const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (isLocal) {
      throw new Error(
        'Azure data requires a Vercel serverless function. Run `vercel dev` instead of `npm run dev` to enable it locally.'
      );
    }
    throw new Error('Azure proxy returned an unexpected HTML response.');
  }

  const data: ProviderStatus = JSON.parse(text);

  return {
    ...data,
    sourceUrl: data.sourceUrl || AZURE_DASHBOARD_URL,
    dataFetchedAt: fetchedAt,
  };
}
