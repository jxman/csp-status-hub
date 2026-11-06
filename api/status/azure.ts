import type { VercelRequest, VercelResponse } from '../_lib/vercel.js';
import type { ProviderStatus } from '../../src/types/status.js';
import { AzureFeedHttpError, fetchAzure } from '../_lib/azureFetcher.js';
import { getRecentlyResolvedIncidents } from '../_lib/resolvedIncidents.js';

const AZURE_DASHBOARD_URL = 'https://azure.status.microsoft/';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const [result, recentlyResolved] = await Promise.all([
      fetchAzure(),
      // Fail open: a Redis hiccup should only hide the "Recently resolved"
      // section, never break the live Azure status.
      getRecentlyResolvedIncidents('azure').catch((err) => {
        console.error('[status/azure] failed to read recently resolved incidents', err);
        return [];
      }),
    ]);
    // Skip any id the feed still (or again) reports — the live entry wins.
    const liveIds = new Set(result.activeIncidents.map((i) => i.id));
    result.activeIncidents.push(...recentlyResolved.filter((i) => !liveIds.has(i.id)));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    res.json(result);
  } catch (err) {
    // Full detail goes to the function logs only. Visitors get a message
    // built here, never the error's own text, which for parse failures can
    // be an internal TypeError ("Cannot read properties of undefined ...").
    console.error('[status/azure] Azure fetch failed', err);
    const message =
      err instanceof AzureFeedHttpError
        ? `Azure's status feed returned HTTP ${Number(err.status)}`
        : "Couldn't read Azure's status feed";
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
