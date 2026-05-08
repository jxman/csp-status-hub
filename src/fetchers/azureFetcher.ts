import type { ProviderStatus } from '../types/status';

// Phase 1: mock — real fetch goes through /api/status/azure (Phase 2)
export async function fetchAzure(): Promise<ProviderStatus> {
  return {
    provider: 'azure',
    displayName: 'Microsoft Azure',
    overallStatus: 'unknown',
    regions: [],
    activeIncidents: [],
    sourceUrl: 'https://azure.status.microsoft/',
    dataFetchedAt: new Date().toISOString(),
    coverageNote: 'Azure status will be available in the next phase via server-side integration. For current Azure health, visit the official status page.',
  };
}
