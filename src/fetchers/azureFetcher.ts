import type { ProviderStatus } from '../types/status';

const AZURE_PROXY_URL = '/api/status/azure';
const AZURE_DASHBOARD_URL = 'https://azure.status.microsoft/';

export async function fetchAzure(): Promise<ProviderStatus> {
  const fetchedAt = new Date().toISOString();

  const response = await fetch(AZURE_PROXY_URL);
  if (!response.ok) {
    throw new Error(`Azure proxy returned ${response.status} ${response.statusText}`);
  }

  const data: ProviderStatus = await response.json();

  return {
    ...data,
    sourceUrl: data.sourceUrl || AZURE_DASHBOARD_URL,
    dataFetchedAt: fetchedAt,
  };
}
