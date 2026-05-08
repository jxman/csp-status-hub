import type { ProviderStatus, StatusLevel } from '../types/status';

const OCI_STATUS_URL = 'https://ocistatus.oraclecloud.com/api/v2/status.json';

interface OciStatusJson {
  page: { name: string; updated_at: string };
  status: { indicator: string; description: string };
}

function mapIndicatorToStatus(indicator: string): StatusLevel {
  switch (indicator) {
    case 'none': return 'operational';
    case 'minor': return 'degraded';
    case 'major': return 'degraded';
    case 'critical': return 'outage';
    case 'maintenance': return 'degraded';
    default: return 'unknown';
  }
}

export async function fetchOci(): Promise<ProviderStatus> {
  const fetchedAt = new Date().toISOString();

  const response = await fetch(OCI_STATUS_URL);
  if (!response.ok) {
    throw new Error(`OCI fetch failed: ${response.status} ${response.statusText}`);
  }

  const data: OciStatusJson = await response.json();
  const overallStatus = mapIndicatorToStatus(data.status?.indicator ?? 'none');

  return {
    provider: 'oci',
    displayName: 'Oracle Cloud',
    overallStatus,
    regions: [],
    activeIncidents: [],
    sourceUrl: 'https://ocistatus.oraclecloud.com/',
    dataFetchedAt: fetchedAt,
    coverageNote: overallStatus !== 'operational'
      ? `OCI reports: ${data.status?.description ?? 'Status unavailable'}`
      : undefined,
  };
}
