import type { Incident, ProviderStatus, StatusLevel } from '../types/status.js';

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
  const description = data.status?.description ?? 'Status unavailable';

  // OCI's public API exposes only a single page-level indicator/description — no
  // per-incident structure like AWS/GCP have (confirmed live: there is no
  // incidents.json equivalent, only this summary endpoint). Synthesize one stable
  // incident ID for "whatever is currently wrong" so the cron's new/resolved
  // incident-ID diffing in check-status.ts has something to diff against; without
  // this, OCI could never generate an alert of either kind. Two genuinely distinct
  // incidents that never pass back through "operational" in between will be treated
  // as one continuous incident — an accepted limitation given the data available.
  const activeIncidents: Incident[] = overallStatus === 'operational'
    ? []
    : [{
        id: 'oci-current-incident',
        title: description,
        status: 'investigating',
        severity: overallStatus === 'outage' ? 'high' : 'medium',
        startTime: data.page?.updated_at ?? fetchedAt,
        endTime: null,
        affectedServices: [],
        affectedRegions: [],
        detailUrl: 'https://ocistatus.oraclecloud.com/',
        latestUpdate: description,
        updatedAt: data.page?.updated_at ?? fetchedAt,
      }];

  return {
    provider: 'oci',
    displayName: 'Oracle Cloud',
    overallStatus,
    regions: [],
    activeIncidents,
    sourceUrl: 'https://ocistatus.oraclecloud.com/',
    dataFetchedAt: fetchedAt,
    coverageNote: overallStatus !== 'operational' ? `OCI reports: ${description}` : undefined,
  };
}
