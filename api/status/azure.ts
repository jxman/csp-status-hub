import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { ProviderStatus } from '../../src/types/status.js';
import { fetchAzure } from '../_lib/azureFetcher.js';

const AZURE_DASHBOARD_URL = 'https://azure.status.microsoft/';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const result = await fetchAzure();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorResult: ProviderStatus = {
      provider: 'azure',
      displayName: 'Microsoft Azure',
      overallStatus: 'unknown',
      regions: [],
      activeIncidents: [],
      sourceUrl: AZURE_DASHBOARD_URL,
      dataFetchedAt: new Date().toISOString(),
      fetchError: message,
    };
    res.setHeader('Cache-Control', 's-maxage=30');
    res.status(200).json(errorResult);
  }
}
