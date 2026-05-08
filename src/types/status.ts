export type StatusLevel = 'operational' | 'degraded' | 'outage' | 'unknown';
export type Provider = 'aws' | 'azure' | 'gcp' | 'oci';

export interface ServiceStatus {
  serviceId: string;
  serviceName: string;
  status: StatusLevel;
  incidents: string[];
}

export interface RegionStatus {
  regionId: string;
  regionName: string;
  geographicArea: string;
  overallStatus: StatusLevel;
  services: ServiceStatus[];
}

export interface Incident {
  id: string;
  title: string;
  status: 'investigating' | 'identified' | 'monitoring' | 'resolved' | 'unknown';
  severity: 'low' | 'medium' | 'high';
  startTime: string;
  endTime: string | null;
  affectedServices: string[];
  affectedRegions: string[];
  detailUrl: string;
  latestUpdate: string;
  updatedAt: string;
}

export interface ProviderStatus {
  provider: Provider;
  displayName: string;
  overallStatus: StatusLevel;
  regions: RegionStatus[];
  activeIncidents: Incident[];
  sourceUrl: string;
  dataFetchedAt: string;
  coverageNote?: string;
  fetchError?: string;
}

export interface DashboardStatus {
  providers: ProviderStatus[];
  lastRefreshedAt: string;
}
