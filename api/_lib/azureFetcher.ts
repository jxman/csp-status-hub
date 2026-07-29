import { XMLParser } from 'fast-xml-parser';
import type { Incident, ProviderStatus, RegionStatus, ServiceStatus, StatusLevel } from '../../src/types/status.js';

const AZURE_FEED_URL = 'https://rssfeed.azure.status.microsoft/en-us/status/feed/';
const AZURE_DASHBOARD_URL = 'https://azure.status.microsoft/';

// Known Azure region display names — used to split category[] into services vs regions
const AZURE_REGIONS = new Set([
  'East US 2', 'East US', 'West US 3', 'West US 2', 'West US',
  'Central US', 'North Central US', 'South Central US', 'West Central US',
  'Canada Central', 'Canada East',
  'Brazil South', 'Brazil Southeast',
  'North Europe', 'West Europe',
  'UK South', 'UK West',
  'France Central', 'France South',
  'Germany West Central', 'Germany North',
  'Switzerland North', 'Switzerland West',
  'Norway East', 'Norway West',
  'Sweden Central', 'Poland Central', 'Spain Central', 'Italy North',
  'Southeast Asia', 'East Asia',
  'Australia Southeast', 'Australia Central 2', 'Australia Central', 'Australia East',
  'Japan East', 'Japan West',
  'Korea Central', 'Korea South',
  'Central India', 'South India', 'West India',
  'UAE Central', 'UAE North',
  'South Africa North', 'South Africa West',
  'Qatar Central',
  'Multiple Regions', 'Global',
]);

// Azure's region names are already an enumerated display-name set (AZURE_REGIONS
// above), not a canonical slug — same situation as OCI (see ALERTS-DESIGN.md 14.10),
// so geographic grouping is done by exact/word match rather than a hand-built slug table.
function azureRegionToGeo(regionName: string): string {
  if (regionName === 'Global' || regionName === 'Multiple Regions') return 'Global';
  const words = regionName.split(' ');
  if (words.includes('US') || words.includes('Canada')) return 'North America';
  if (words.includes('Brazil')) return 'South America';
  if (regionName.includes('South Africa')) return 'Africa';
  if (words.includes('Australia')) return 'Australia';
  if (words.includes('UAE') || words.includes('Qatar')) return 'Middle East';
  if (['UK', 'Europe', 'France', 'Germany', 'Switzerland', 'Norway', 'Sweden', 'Poland', 'Spain', 'Italy']
    .some((w) => words.includes(w))) return 'Europe';
  if (['Asia', 'Japan', 'Korea', 'India'].some((w) => words.includes(w))) return 'Asia Pacific';
  return 'Global';
}

// AWS flags edge/global-scoped services with regionId 'global' (see claude.md Known
// Constraints — CloudFront, Route 53 carry no region segment). Mirror that convention
// here so Azure's broad-impact incidents get the same "+" treatment in the dashboard's
// regions-impacted stat, instead of a differently-cased region bucket the UI doesn't recognize.
function regionIdFor(regionName: string): string {
  return regionName === 'Global' || regionName === 'Multiple Regions' ? 'global' : regionName;
}

function serviceIdFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service';
}

function worstStatus(statuses: StatusLevel[]): StatusLevel {
  if (statuses.includes('outage')) return 'outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('unknown')) return 'unknown';
  return 'operational';
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractText(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && val !== null && '#text' in val) {
    return String((val as Record<string, unknown>)['#text'] ?? '');
  }
  return String(val);
}

function parseSeverity(title: string): Incident['severity'] {
  const t = title.toLowerCase();
  if (t.includes('service disruption') || t.includes('outage')) return 'high';
  if (t.includes('degraded') || t.includes('degradation') || t.includes('performance') ||
      t.includes('connectivity') || t.includes('latency') || t.includes('multi service')) return 'medium';
  return 'medium';
}

function parseStatus(title: string): Incident['status'] {
  const t = title.toLowerCase();
  if (t.startsWith('rca') || t.includes('post-incident') || t.includes('root cause')) return 'resolved';
  if (t.startsWith('resolved') || t.includes('resolved')) return 'resolved';
  if (t.startsWith('mitigated') || t.includes('mitigated')) return 'resolved';
  if (t.startsWith('monitoring') || t.includes('monitoring')) return 'monitoring';
  if (t.startsWith('identified') || t.includes('identified')) return 'identified';
  if (t.startsWith('investigating') || t.includes('investigating')) return 'investigating';
  // Azure RSS titles often start with "Active –" for ongoing incidents
  if (t.startsWith('active')) return 'investigating';
  return 'unknown';
}

function extractCategories(raw: unknown): string[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((c) => extractText(c)).filter(Boolean);
}

function parseAffected(title: string, categories: string[]): { services: string[]; regions: string[] } {
  // Prefer structured <category> elements (present in RSS format)
  if (categories.length > 0) {
    const regions = categories.filter((c) => AZURE_REGIONS.has(c));
    const services = categories.filter((c) => !AZURE_REGIONS.has(c));
    return { services, regions };
  }

  // Fallback: extract from title text
  const foundRegions: string[] = [];
  for (const region of AZURE_REGIONS) {
    if (title.includes(region)) foundRegions.push(region);
  }
  const cleaned = title.replace(/^(Active|Investigating|Monitoring|Identified|Mitigated|Resolved|RCA)\s*[-–]\s*/i, '');
  const parts = cleaned.split(/\s*[-–]\s+/);
  const services = parts.length > 0 && parts[0].trim() ? [parts[0].trim()] : [];
  return { services, regions: foundRegions };
}

interface RawEntry {
  // Atom fields
  id?: unknown;
  title?: unknown;
  published?: unknown;
  updated?: unknown;
  summary?: unknown;
  link?: unknown;
  // RSS fields
  guid?: unknown;
  pubDate?: unknown;
  description?: unknown;
  category?: unknown;
}

function toIso(val: unknown): string {
  const raw = String(val ?? '');
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function entryToIncident(entry: RawEntry, index: number, feedUpdatedAt?: string): Incident {
  const title = extractText(entry.title) || 'Azure Incident';
  // RSS uses <description>; Atom uses <summary>
  const summary = extractText(entry.summary || entry.description);
  // startTime = item pubDate (when incident began)
  // updatedAt = channel lastBuildDate (when feed was last updated) > item updated > pubDate
  const published = toIso(entry.published ?? entry.pubDate);
  const updated = toIso(entry.updated ?? feedUpdatedAt ?? entry.pubDate ?? entry.published);
  const rawId = extractText(entry.id || entry.guid) || `azure-${index}`;
  const id = encodeURIComponent(rawId).slice(0, 128);

  const incidentStatus = parseStatus(title);
  const severity = parseSeverity(title);
  const categories = extractCategories(entry.category);
  const { services, regions } = parseAffected(title, categories);
  const isResolved = incidentStatus === 'resolved';

  return {
    id,
    title,
    status: incidentStatus,
    severity,
    startTime: published,
    endTime: isResolved ? updated : null,
    affectedServices: services,
    affectedRegions: regions,
    // Microsoft's own feed <link> points at a raw backend App Service host
    // (e.g. azurestatusprodeus.azurewebsites.net) rather than the public
    // azure.status.microsoft domain, and it's the same generic root URL on
    // every entry — not an incident-specific deep link. Use the stable
    // public domain instead of trusting the feed's link verbatim.
    detailUrl: AZURE_DASHBOARD_URL,
    latestUpdate: stripHtml(summary),
    updatedAt: updated,
  };
}

function extractEntries(parsed: Record<string, unknown>): { entries: RawEntry[]; feedUpdatedAt?: string } {
  // RSS format: rss.channel.item
  if (parsed?.rss) {
    const channel = ((parsed.rss as Record<string, unknown>)?.channel as Record<string, unknown>) ?? {};
    const lastBuildDate = channel?.lastBuildDate ? toIso(channel.lastBuildDate) : undefined;
    return { entries: [channel?.item ?? []].flat() as RawEntry[], feedUpdatedAt: lastBuildDate };
  }
  // Atom format: feed.entry
  if (parsed?.feed) {
    const feedData = (parsed.feed as Record<string, unknown>) ?? {};
    const feedUpdated = feedData?.updated ? toIso(feedData.updated) : undefined;
    return { entries: [feedData?.entry ?? []].flat() as RawEntry[], feedUpdatedAt: feedUpdated };
  }
  return { entries: [] };
}

export async function fetchAzure(): Promise<ProviderStatus> {
  const fetchedAt = new Date().toISOString();

  const response = await fetch(AZURE_FEED_URL, {
    headers: { 'User-Agent': 'csp-status-hub/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Azure feed returned ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    isArray: (name) => name === 'item' || name === 'entry' || name === 'category',
  });

  const parsed = parser.parse(xml) as Record<string, unknown>;
  const { entries: rawEntries, feedUpdatedAt } = extractEntries(parsed);

  const incidents = rawEntries.map((entry, i) => entryToIncident(entry, i, feedUpdatedAt));
  const activeIncidents = incidents.filter((inc) => inc.status !== 'resolved');

  const overallStatus: StatusLevel = activeIncidents.length === 0
    ? 'operational'
    : activeIncidents.some((inc) => inc.severity === 'high')
      ? 'outage'
      : 'degraded';

  // Roll active incidents up into a region x service breakdown, matching the
  // AWS/GCP/OCI region-table UI — Azure's feed has no structured region/service
  // grid of its own (see claude.md 3.2), so it's built here from each incident's
  // parsed affectedRegions/affectedServices. Incidents with no parseable region
  // (empty affectedRegions — title/categories didn't match AZURE_REGIONS) fall
  // into a 'Global' bucket rather than silently dropping their service impact.
  const regionMap = new Map<string, Map<string, ServiceStatus>>();
  for (const inc of activeIncidents) {
    const svcStatus: StatusLevel = inc.severity === 'high' ? 'outage' : 'degraded';
    const regionNames = inc.affectedRegions.length > 0 ? inc.affectedRegions : ['Global'];
    const serviceNames = inc.affectedServices.length > 0 ? inc.affectedServices : ['Multiple Services'];

    for (const regionName of regionNames) {
      if (!regionMap.has(regionName)) regionMap.set(regionName, new Map());
      const serviceMap = regionMap.get(regionName)!;
      for (const serviceName of serviceNames) {
        const serviceId = serviceIdFromName(serviceName);
        const existing = serviceMap.get(serviceId);
        if (existing) {
          existing.incidents.push(inc.id);
          existing.status = worstStatus([existing.status, svcStatus]);
        } else {
          serviceMap.set(serviceId, { serviceId, serviceName, status: svcStatus, incidents: [inc.id] });
        }
      }
    }
  }

  const regions: RegionStatus[] = Array.from(regionMap.entries()).map(([regionName, serviceMap]) => {
    const services = Array.from(serviceMap.values());
    return {
      regionId: regionIdFor(regionName),
      regionName,
      geographicArea: azureRegionToGeo(regionName),
      overallStatus: worstStatus(services.map((s) => s.status)),
      services,
    };
  });

  return {
    provider: 'azure',
    displayName: 'Microsoft Azure',
    overallStatus,
    regions,
    activeIncidents: incidents,
    sourceUrl: AZURE_DASHBOARD_URL,
    dataFetchedAt: fetchedAt,
  };
}
