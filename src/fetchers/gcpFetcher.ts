import type { Incident, ProviderStatus, RegionStatus, ServiceStatus, StatusLevel } from '../types/status';

const GCP_INCIDENTS_URL = 'https://status.cloud.google.com/incidents.json';

interface GcpLocation {
  title: string;
  id: string;
}

interface GcpProduct {
  title: string;
  id: string;
}

interface GcpUpdate {
  created: string;
  modified: string;
  text: string;
  status: string;
  affected_locations: GcpLocation[];
}

interface GcpIncident {
  id: string;
  number: number;
  begin: string;
  end?: string | null;
  severity: 'low' | 'medium' | 'high';
  external_desc: string;
  affected_products: GcpProduct[];
  updates: GcpUpdate[];
  uri: string;
}

// GCP omits the `end` field entirely for ongoing incidents rather than setting it to null,
// so callers must treat undefined the same as null when checking incident state.
function isIncidentOpen(end: string | null | undefined): boolean {
  return end == null;
}

function mapSeverityToStatus(severity: string): StatusLevel {
  switch (severity) {
    case 'high': return 'outage';
    case 'medium': return 'degraded';
    case 'low': return 'degraded';
    default: return 'unknown';
  }
}

function worstStatus(statuses: StatusLevel[]): StatusLevel {
  if (statuses.includes('outage')) return 'outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('unknown')) return 'unknown';
  return 'operational';
}

function gcpUpdateStatusToIncidentStatus(status: string): Incident['status'] {
  const s = status.toUpperCase();
  if (s.includes('DISRUPTION')) return 'investigating';
  if (s.includes('INFORMATION')) return 'monitoring';
  if (s.includes('AVAILABLE')) return 'resolved';
  return 'unknown';
}

export async function fetchGcp(): Promise<ProviderStatus> {
  const fetchedAt = new Date().toISOString();

  const response = await fetch(GCP_INCIDENTS_URL);
  if (!response.ok) {
    throw new Error(`GCP fetch failed: ${response.status} ${response.statusText}`);
  }

  const allIncidents: GcpIncident[] = await response.json();
  // An open end (null or absent) is the primary active flag; also exclude incidents where
  // the latest update is AVAILABLE — service restored but GCP hasn't formally closed the incident yet
  const active = allIncidents.filter((inc) => {
    if (!isIncidentOpen(inc.end)) return false;
    const latestUpdate = inc.updates[0];
    if (latestUpdate?.status === 'AVAILABLE') return false;
    return true;
  });

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  const recentlyResolved = allIncidents.filter((inc) => {
    if (!isIncidentOpen(inc.end)) return new Date(inc.end!).getTime() >= cutoff;
    const latestUpdate = inc.updates[0];
    return latestUpdate?.status === 'AVAILABLE' && new Date(latestUpdate.modified).getTime() >= cutoff;
  });

  const regionMap = new Map<string, { name: string; serviceMap: Map<string, { name: string; incidentIds: string[]; status: StatusLevel }> }>();

  const activeIncidents: Incident[] = [
    ...active.map((inc) => {
      const latestUpdate = inc.updates[0] ?? null;
      const affectedRegions: string[] = [];
      const affectedServices = inc.affected_products.map((p) => p.title);
      const incidentStatus = mapSeverityToStatus(inc.severity);

      if (latestUpdate) {
        for (const loc of latestUpdate.affected_locations) {
          affectedRegions.push(loc.id);

          if (!regionMap.has(loc.id)) {
            regionMap.set(loc.id, { name: loc.title, serviceMap: new Map() });
          }
          const regionEntry = regionMap.get(loc.id)!;

          for (const product of inc.affected_products) {
            const existing = regionEntry.serviceMap.get(product.id);
            if (!existing) {
              regionEntry.serviceMap.set(product.id, {
                name: product.title,
                incidentIds: [inc.id],
                status: incidentStatus,
              });
            } else {
              existing.incidentIds.push(inc.id);
              existing.status = worstStatus([existing.status, incidentStatus]);
            }
          }
        }
      }

      const incidentSummaryStatus = gcpUpdateStatusToIncidentStatus(latestUpdate?.status ?? '');

      return {
        id: inc.id,
        title: inc.external_desc,
        status: incidentSummaryStatus,
        severity: inc.severity,
        startTime: inc.begin,
        endTime: inc.end ?? null,
        affectedServices,
        affectedRegions,
        detailUrl: inc.uri ?? `https://status.cloud.google.com/incidents/${inc.id}`,
        latestUpdate: latestUpdate?.text ?? '',
        updatedAt: latestUpdate?.modified ?? inc.begin,
      };
    }),
    ...recentlyResolved.map((inc) => {
      const latestUpdate = inc.updates[0] ?? null;
      const affectedServices = inc.affected_products.map((p) => p.title);
      const affectedRegions: string[] = latestUpdate?.affected_locations.map((l) => l.id) ?? [];
      const resolvedAt = inc.end ?? latestUpdate?.modified ?? inc.begin;
      return {
        id: inc.id,
        title: inc.external_desc,
        status: 'resolved' as const,
        severity: inc.severity,
        startTime: inc.begin,
        endTime: resolvedAt,
        affectedServices,
        affectedRegions,
        detailUrl: inc.uri ?? `https://status.cloud.google.com/incidents/${inc.id}`,
        latestUpdate: latestUpdate?.text ?? '',
        updatedAt: latestUpdate?.modified ?? resolvedAt,
      };
    }),
  ];

  const regions: RegionStatus[] = Array.from(regionMap.entries()).map(([regionId, regionData]) => {
    const services: ServiceStatus[] = Array.from(regionData.serviceMap.entries()).map(([serviceId, svc]) => ({
      serviceId,
      serviceName: svc.name,
      status: svc.status,
      incidents: svc.incidentIds,
    }));

    return {
      regionId,
      regionName: regionData.name,
      geographicArea: deriveGcpGeoArea(regionId),
      overallStatus: worstStatus(services.map((s) => s.status)),
      services,
    };
  });

  const overallStatus = active.length === 0
    ? 'operational'
    : worstStatus(active.map((inc) => mapSeverityToStatus(inc.severity)));

  return {
    provider: 'gcp',
    displayName: 'Google Cloud',
    overallStatus,
    regions,
    activeIncidents,
    sourceUrl: 'https://status.cloud.google.com/',
    dataFetchedAt: fetchedAt,
  };
}

function deriveGcpGeoArea(regionId: string): string {
  if (regionId.startsWith('us-') || regionId.startsWith('northamerica-') || regionId.startsWith('southamerica-')) {
    return regionId.startsWith('southamerica-') ? 'South America' : 'North America';
  }
  if (regionId.startsWith('europe-')) return 'Europe';
  if (regionId.startsWith('asia-') || regionId.startsWith('australia-')) {
    return regionId.startsWith('australia-') ? 'Australia' : 'Asia Pacific';
  }
  if (regionId.startsWith('me-')) return 'Middle East';
  if (regionId.startsWith('africa-')) return 'Africa';
  return 'Global';
}
