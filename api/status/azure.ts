import type { VercelRequest, VercelResponse } from '@vercel/node';
import { XMLParser } from 'fast-xml-parser';
import type { Incident, ProviderStatus, StatusLevel } from '../../src/types/status.js';

const AZURE_FEED_URL = 'https://azurestatuscdn.azureedge.net/en-us/status/feed/';
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

function extractLink(link: unknown): string {
  if (!link) return AZURE_DASHBOARD_URL;
  const candidates = Array.isArray(link) ? link : [link];
  const alternate = candidates.find(
    (l) => typeof l === 'object' && l !== null && (l as Record<string, unknown>)['@_rel'] === 'alternate'
  ) ?? candidates[0];
  if (typeof alternate === 'object' && alternate !== null) {
    return String((alternate as Record<string, unknown>)['@_href'] ?? AZURE_DASHBOARD_URL);
  }
  if (typeof alternate === 'string' && alternate.startsWith('http')) return alternate;
  return AZURE_DASHBOARD_URL;
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
  const link = extractLink(entry.link);
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
    detailUrl: link,
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

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const fetchedAt = new Date().toISOString();

  try {
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
    const activeCount = incidents.filter((inc) => inc.status !== 'resolved').length;

    const overallStatus: StatusLevel = activeCount === 0
      ? 'operational'
      : incidents.some((inc) => inc.status !== 'resolved' && inc.severity === 'high')
        ? 'outage'
        : 'degraded';

    const result: ProviderStatus = {
      provider: 'azure',
      displayName: 'Microsoft Azure',
      overallStatus,
      regions: [],
      activeIncidents: incidents,
      sourceUrl: AZURE_DASHBOARD_URL,
      dataFetchedAt: fetchedAt,
    };

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
      dataFetchedAt: fetchedAt,
      fetchError: message,
    };
    res.setHeader('Cache-Control', 's-maxage=30');
    res.status(200).json(errorResult);
  }
}
