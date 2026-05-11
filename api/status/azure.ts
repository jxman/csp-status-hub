import type { VercelRequest, VercelResponse } from '@vercel/node';
import { XMLParser } from 'fast-xml-parser';
import type { Incident, ProviderStatus, StatusLevel } from '../../src/types/status.js';

const AZURE_FEED_URL = 'https://azurestatuscdn.azureedge.net/en-us/status/feed/';
const AZURE_DASHBOARD_URL = 'https://azure.status.microsoft/';

// Known Azure region display names for free-text extraction from titles
const AZURE_REGIONS = [
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
];

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
  return AZURE_DASHBOARD_URL;
}

function parseSeverity(title: string): Incident['severity'] {
  const t = title.toLowerCase();
  if (t.includes('service disruption') || t.includes('outage')) return 'high';
  if (t.includes('degraded') || t.includes('performance') || t.includes('connectivity') || t.includes('latency')) return 'medium';
  return 'medium';
}

function parseStatus(title: string): Incident['status'] {
  const t = title.toLowerCase();
  if (t.startsWith('rca') || t.includes('post-incident') || t.includes('root cause')) return 'resolved';
  if (t.includes('mitigated') || t.includes('resolved')) return 'resolved';
  if (t.includes('monitoring')) return 'monitoring';
  if (t.includes('identified')) return 'identified';
  if (t.includes('investigating')) return 'investigating';
  return 'unknown';
}

function parseAffected(title: string): { services: string[]; regions: string[] } {
  const foundRegions: string[] = [];
  for (const region of AZURE_REGIONS) {
    if (title.includes(region)) foundRegions.push(region);
  }

  // Strip "RCA - " prefix, then take the first dash-delimited segment as the service
  const cleaned = title.replace(/^RCA\s*[-–]\s*/i, '');
  const parts = cleaned.split(/\s*[-–]\s+/);
  const services = parts.length > 0 && parts[0].trim() ? [parts[0].trim()] : [];

  return { services, regions: foundRegions };
}

interface RawEntry {
  id?: unknown;
  title?: unknown;
  published?: unknown;
  updated?: unknown;
  summary?: unknown;
  link?: unknown;
}

function entryToIncident(entry: RawEntry, index: number): Incident {
  const title = extractText(entry.title) || 'Azure Incident';
  const summary = extractText(entry.summary);
  const published = String(entry.published ?? new Date().toISOString());
  const updated = String(entry.updated ?? published);
  const link = extractLink(entry.link);
  const rawId = extractText(entry.id) || `azure-${index}`;
  const id = encodeURIComponent(rawId).slice(0, 128);

  const incidentStatus = parseStatus(title);
  const severity = parseSeverity(title);
  const { services, regions } = parseAffected(title);
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
    });

    const parsed = parser.parse(xml) as Record<string, unknown>;
    const feedData = (parsed?.feed as Record<string, unknown>) ?? {};
    const rawEntries: RawEntry[] = [feedData?.entry ?? []].flat() as RawEntry[];

    const incidents = rawEntries.map((entry, i) => entryToIncident(entry, i));
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

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
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
