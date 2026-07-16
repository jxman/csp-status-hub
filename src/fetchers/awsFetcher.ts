import { XMLParser } from 'fast-xml-parser';
import type { Incident, ProviderStatus, RegionStatus, ServiceStatus, StatusLevel } from '../types/status.js';
import { AWS_CRITICAL_SERVICE_IDS, AWS_SERVICE_NAMES, AWS_SERVICE_RSS_SLUGS, type AwsServiceRssConfig } from '../utils/awsServices.js';

const AWS_RSS_URL = 'https://status.aws.amazon.com/rss/all.rss';

const AWS_REGIONS = new Set([
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1',
  'eu-central-2', 'eu-north-1', 'eu-south-1', 'eu-south-2',
  'ap-southeast-1', 'ap-southeast-2', 'ap-southeast-3', 'ap-southeast-4',
  'ap-northeast-1', 'ap-northeast-2', 'ap-northeast-3',
  'ap-south-1', 'ap-south-2', 'ap-east-1',
  'sa-east-1', 'ca-central-1', 'ca-west-1',
  'me-south-1', 'me-central-1',
  'af-south-1', 'il-central-1',
  'us-gov-east-1', 'us-gov-west-1',
]);

const AWS_RSS_BASE = 'https://status.aws.amazon.com/rss';

interface RssItem {
  title: string;
  link: string;
  guid: string;
  pubDate: string;
  description?: string;
}

// fast-xml-parser returns attributed elements as { '#text': value, '@_attr': ... }
function xmlText(val: unknown): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val !== null && '#text' in val) return String((val as Record<string, unknown>)['#text']);
  return '';
}

function parseRssXml(xml: string): RssItem[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const rawItems: unknown[] = [parsed?.rss?.channel?.item ?? []].flat();
  return rawItems
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      title: xmlText(item['title']),
      link: xmlText(item['link']),
      guid: xmlText(item['guid']),
      pubDate: xmlText(item['pubDate']),
      description: item['description'] ? xmlText(item['description']) : undefined,
    }));
}

function parseGuid(guid: string): { service: string; region: string } {
  const fragment = guid.split('#')[1] ?? '';
  const withoutTimestamp = fragment.split('_')[0];

  for (const region of AWS_REGIONS) {
    const suffix = `-${region}`;
    if (withoutTimestamp.endsWith(suffix)) {
      const service = withoutTimestamp.slice(0, -suffix.length) || 'multipleservices';
      return { service, region };
    }
  }
  // No region suffix matched — this is a global/edge service (e.g. CloudFront,
  // Route 53, IAM), whose GUIDs carry no region segment at all.
  if (withoutTimestamp) return { service: withoutTimestamp, region: 'global' };
  return { service: 'unknown', region: 'unknown' };
}

function deduplicateItems(items: RssItem[]): RssItem[] {
  const groups = new Map<string, RssItem>();
  for (const item of items) {
    const base = item.guid.replace(/_\d+$/, '');
    const existing = groups.get(base);
    if (!existing || new Date(item.pubDate) > new Date(existing.pubDate)) {
      groups.set(base, item);
    }
  }
  return Array.from(groups.values());
}

function inferStatus(title: string): StatusLevel {
  const lower = title.toLowerCase();
  if (lower.includes('operating normally') || lower.includes('[resolved]')) return 'operational';
  if (lower.includes('service disruption')) return 'outage';
  if (lower.includes('service impact') || lower.includes('performance issues')) return 'degraded';
  if (lower.includes('informational')) return 'degraded';
  return 'degraded';
}

function isResolved(title: string): boolean {
  const lower = title.toLowerCase();
  return lower.includes('operating normally') || lower.includes('[resolved]');
}

function worstStatus(statuses: StatusLevel[]): StatusLevel {
  if (statuses.includes('outage')) return 'outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('unknown')) return 'unknown';
  return 'operational';
}

function awsRegionToGeo(region: string): string {
  if (region === 'global') return 'Global';
  if (region.startsWith('us-') || region.startsWith('ca-')) return 'North America';
  if (region.startsWith('eu-') || region.startsWith('il-')) return 'Europe';
  if (region.startsWith('ap-') || region.startsWith('sa-')) {
    return region.startsWith('sa-') ? 'South America' : 'Asia Pacific';
  }
  if (region.startsWith('me-')) return 'Middle East';
  if (region.startsWith('af-')) return 'Africa';
  if (region.startsWith('us-gov-')) return 'US GovCloud';
  return 'Global';
}

function friendlyRegionName(regionId: string): string {
  if (regionId === 'global') return 'Global';
  const names: Record<string, string> = {
    'us-east-1': 'US East (N. Virginia)',
    'us-east-2': 'US East (Ohio)',
    'us-west-1': 'US West (N. California)',
    'us-west-2': 'US West (Oregon)',
    'eu-west-1': 'Europe (Ireland)',
    'eu-west-2': 'Europe (London)',
    'eu-west-3': 'Europe (Paris)',
    'eu-central-1': 'Europe (Frankfurt)',
    'eu-central-2': 'Europe (Zurich)',
    'eu-north-1': 'Europe (Stockholm)',
    'eu-south-1': 'Europe (Milan)',
    'eu-south-2': 'Europe (Spain)',
    'ap-southeast-1': 'Asia Pacific (Singapore)',
    'ap-southeast-2': 'Asia Pacific (Sydney)',
    'ap-southeast-3': 'Asia Pacific (Jakarta)',
    'ap-southeast-4': 'Asia Pacific (Melbourne)',
    'ap-northeast-1': 'Asia Pacific (Tokyo)',
    'ap-northeast-2': 'Asia Pacific (Seoul)',
    'ap-northeast-3': 'Asia Pacific (Osaka)',
    'ap-south-1': 'Asia Pacific (Mumbai)',
    'ap-south-2': 'Asia Pacific (Hyderabad)',
    'ap-east-1': 'Asia Pacific (Hong Kong)',
    'sa-east-1': 'South America (São Paulo)',
    'ca-central-1': 'Canada (Central)',
    'ca-west-1': 'Canada West (Calgary)',
    'me-south-1': 'Middle East (Bahrain)',
    'me-central-1': 'Middle East (UAE)',
    'af-south-1': 'Africa (Cape Town)',
    'il-central-1': 'Israel (Tel Aviv)',
    'us-gov-east-1': 'AWS GovCloud (US-East)',
    'us-gov-west-1': 'AWS GovCloud (US-West)',
  };
  return names[regionId] ?? regionId;
}

export async function fetchAws(): Promise<ProviderStatus> {
  const fetchedAt = new Date().toISOString();

  const response = await fetch(AWS_RSS_URL);
  if (!response.ok) {
    throw new Error(`AWS fetch failed: ${response.status} ${response.statusText}`);
  }

  const items = parseRssXml(await response.text());

  // Keep only the most recent update per incident; split into active vs recently resolved
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const allDeduplicated = deduplicateItems(items);
  const activeItems = allDeduplicated.filter((item) => !isResolved(item.title));
  const recentlyResolvedItems = allDeduplicated.filter(
    (item) => isResolved(item.title) && new Date(item.pubDate).getTime() >= Date.now() - TWENTY_FOUR_HOURS_MS
  );

  const regionMap = new Map<string, { serviceMap: Map<string, { status: StatusLevel; incidentIds: string[] }> }>();

  const activeIncidents: Incident[] = [
    ...activeItems.map((item) => {
      const { service, region } = parseGuid(item.guid);
      const status = inferStatus(item.title);
      const incidentId = item.guid.replace(/_\d+$/, '');

      if (!regionMap.has(region)) {
        regionMap.set(region, { serviceMap: new Map() });
      }
      const regionEntry = regionMap.get(region)!;
      const existing = regionEntry.serviceMap.get(service);
      if (!existing) {
        regionEntry.serviceMap.set(service, { status, incidentIds: [incidentId] });
      } else {
        existing.incidentIds.push(incidentId);
        existing.status = worstStatus([existing.status, status]);
      }

      return {
        id: incidentId,
        title: item.title,
        status: 'investigating' as const,
        severity: (status === 'outage' ? 'high' : 'medium') as 'high' | 'medium',
        startTime: item.pubDate ? new Date(item.pubDate).toISOString() : fetchedAt,
        endTime: null,
        affectedServices: [service],
        affectedRegions: [region],
        detailUrl: item.link || 'https://status.aws.amazon.com/',
        latestUpdate: item.description ?? item.title,
        updatedAt: item.pubDate ? new Date(item.pubDate).toISOString() : fetchedAt,
      };
    }),
    ...recentlyResolvedItems.map((item) => {
      const { service, region } = parseGuid(item.guid);
      const incidentId = item.guid.replace(/_\d+$/, '');
      const resolvedAt = item.pubDate ? new Date(item.pubDate).toISOString() : fetchedAt;
      return {
        id: incidentId,
        title: item.title,
        status: 'resolved' as const,
        severity: 'low' as const,
        startTime: resolvedAt,
        endTime: resolvedAt,
        affectedServices: [service],
        affectedRegions: [region],
        detailUrl: item.link || 'https://status.aws.amazon.com/',
        latestUpdate: item.description ?? item.title,
        updatedAt: resolvedAt,
      };
    }),
  ];

  // For any region where all.rss only gave us a 'multipleservices' entry, fetch the
  // per-service RSS feeds in parallel to get actual per-service status.
  const broadImpactRegions = Array.from(regionMap.entries())
    .filter(([, data]) => data.serviceMap.has('multipleservices') && data.serviceMap.size === 1)
    .map(([regionId]) => regionId);

  if (broadImpactRegions.length > 0) {
    const configuredIds = AWS_CRITICAL_SERVICE_IDS.filter((id) => id in AWS_SERVICE_RSS_SLUGS);
    const globalIds = configuredIds.filter((id) => (AWS_SERVICE_RSS_SLUGS[id] as AwsServiceRssConfig).global);
    const regionalIds = configuredIds.filter((id) => !(AWS_SERVICE_RSS_SLUGS[id] as AwsServiceRssConfig).global);

    // Global services (IAM, Route 53): fetch once, share result across all affected regions
    const globalResults = await Promise.allSettled(
      globalIds.map((id) =>
        fetch(`${AWS_RSS_BASE}/${AWS_SERVICE_RSS_SLUGS[id].slug}.rss`).then((r) => (r.ok ? r.text() : null))
      )
    );
    const globalStatuses = new Map<string, { status: StatusLevel; incidentIds: string[] }>();
    for (let i = 0; i < globalIds.length; i++) {
      const result = globalResults[i];
      if (result.status === 'rejected' || result.value == null) {
        globalStatuses.set(globalIds[i], { status: 'unknown', incidentIds: [] });
      } else {
        const items = deduplicateItems(parseRssXml(result.value)).filter((it) => !isResolved(it.title));
        globalStatuses.set(globalIds[i], items.length === 0
          ? { status: 'operational', incidentIds: [] }
          : { status: worstStatus(items.map((it) => inferStatus(it.title))), incidentIds: items.map((it) => it.guid.replace(/_\d+$/, '')) }
        );
      }
    }

    // Regional services: fetch per-region in parallel; 404 = operational (feed absent = no issues)
    const regionalTasks = broadImpactRegions.flatMap((region) =>
      regionalIds.map((serviceId) => ({ region, serviceId, slug: AWS_SERVICE_RSS_SLUGS[serviceId].slug }))
    );
    const regionalResults = await Promise.allSettled(
      regionalTasks.map(({ slug, region }) =>
        fetch(`${AWS_RSS_BASE}/${slug}-${region}.rss`).then((r) => {
          if (r.ok) return r.text();
          return r.status === 404 ? '' : null; // '' → no items → operational; null → unknown
        })
      )
    );
    for (let i = 0; i < regionalTasks.length; i++) {
      const { region, serviceId } = regionalTasks[i];
      const result = regionalResults[i];
      const serviceMap = regionMap.get(region)!.serviceMap;
      if (result.status === 'rejected' || result.value == null) {
        serviceMap.set(serviceId, { status: 'unknown', incidentIds: [] });
        continue;
      }
      const items = deduplicateItems(parseRssXml(result.value)).filter((it) => !isResolved(it.title));
      serviceMap.set(serviceId, items.length === 0
        ? { status: 'operational', incidentIds: [] }
        : { status: worstStatus(items.map((it) => inferStatus(it.title))), incidentIds: items.map((it) => it.guid.replace(/_\d+$/, '')) }
      );
    }

    // Apply global results to every broad-impact region
    for (const region of broadImpactRegions) {
      const serviceMap = regionMap.get(region)!.serviceMap;
      for (const [serviceId, svcStatus] of globalStatuses) {
        serviceMap.set(serviceId, svcStatus);
      }
    }
  }

  const regions: RegionStatus[] = Array.from(regionMap.entries()).map(([regionId, regionData]) => {
    const services: ServiceStatus[] = Array.from(regionData.serviceMap.entries()).map(([serviceId, svc]) => ({
      serviceId,
      serviceName: AWS_SERVICE_NAMES[serviceId] ?? serviceId.toUpperCase(),
      status: svc.status,
      incidents: svc.incidentIds,
    }));

    return {
      regionId,
      regionName: friendlyRegionName(regionId),
      geographicArea: awsRegionToGeo(regionId),
      overallStatus: worstStatus(services.map((s) => s.status)),
      services,
    };
  });

  const overallStatus = activeItems.length === 0
    ? 'operational'
    : worstStatus(activeItems.map((item) => inferStatus(item.title)));

  return {
    provider: 'aws',
    displayName: 'Amazon Web Services',
    overallStatus,
    regions,
    activeIncidents,
    sourceUrl: 'https://status.aws.amazon.com/',
    dataFetchedAt: fetchedAt,
  };
}
