import type { ProviderStatus } from '../types/status';

const AZURE_PROXY_URL = '/api/status/azure';
const AZURE_DASHBOARD_URL = 'https://azure.status.microsoft/';
const COVERAGE_NOTE =
  "Azure's public status page reports only major widespread incidents. For account-specific or service-level health, visit Azure Service Health in the Azure portal.";

export async function fetchAzure(): Promise<ProviderStatus> {
  const fetchedAt = new Date().toISOString();

  const response = await fetch(AZURE_PROXY_URL);
  if (!response.ok) {
    throw new Error(`Azure proxy returned ${response.status} ${response.statusText}`);
  }

  const data: ProviderStatus = await response.json();

  // Ensure coverageNote is always present on the client side even if the
  // serverless function omits it (e.g. on a cached stale response)
  return {
    ...data,
    coverageNote: data.coverageNote ?? COVERAGE_NOTE,
    sourceUrl: data.sourceUrl || AZURE_DASHBOARD_URL,
    dataFetchedAt: fetchedAt,
  };
}
