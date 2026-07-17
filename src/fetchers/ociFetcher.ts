import { XMLParser } from 'fast-xml-parser';
import type { Incident, ProviderStatus, RegionStatus, ServiceStatus, StatusLevel } from '../types/status.js';

const OCI_STATUS_URL = 'https://ocistatus.oraclecloud.com/api/v2/status.json';
const OCI_INCIDENT_RSS_URL = 'https://ocistatus.oraclecloud.com/api/v2/incident-summary.rss';
const MULTIPLE_SERVICES_ID = 'multipleservices';

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

// fast-xml-parser returns attributed elements as { '#text': value, '@_attr': ... }
function xmlText(val: unknown): string {
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  if (typeof val === 'object' && val !== null && '#text' in val) return String((val as Record<string, unknown>)['#text']);
  return '';
}

interface OciRssItem {
  title: string;
  description: string;
  link: string;
  guid: string;
  pubDate: string;
}

// Unlike AWS's all.rss, OCI's incident-summary.rss keeps one persistent <item> per
// incident — the <guid> is a stable OCID that Oracle updates in place as the incident
// progresses (pubDate and description both grow with each new update, same guid
// throughout). No dedup/grouping pass is needed here, unlike awsFetcher.ts.
function parseOciRss(xml: string): OciRssItem[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);
  const rawItems: unknown[] = [parsed?.rss?.channel?.item ?? []].flat();
  return rawItems
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      title: xmlText(item['title']),
      description: xmlText(item['description']),
      link: xmlText(item['link']),
      guid: xmlText(item['guid']),
      pubDate: xmlText(item['pubDate']),
    }));
}

// Title is "{service or category} | {region display name} | {reference}", e.g.
// "Virtual Cloud Network (VCN) | US East (Ashburn) | 210f910e". Some incidents use
// broad labels ("Networking", "Multiple Services", "Multiple Regions") — the same
// fallback shape AWS ("multipleservices") and GCP already have.
function parseTitle(title: string): { service: string; region: string } {
  const parts = title.split('|').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { service: parts[0], region: parts[1] };
  return { service: title.trim() || 'Unknown', region: 'Unknown' };
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function serviceIdFor(serviceName: string): string {
  return serviceName.toLowerCase() === 'multiple services' ? MULTIPLE_SERVICES_ID : slugify(serviceName);
}

// Each <description> is HTML, one <p> block per update, newest first. Each block
// opens "<strong>{StatusWord}</strong> - {narrative}" where StatusWord is
// Investigating / Identified / Monitoring / Resolved — maps directly onto
// Incident['status'], no title-guessing heuristic needed (unlike Azure's parseStatus).
function latestBlock(description: string): string {
  return description.match(/<p>([\s\S]*?)<\/p>/)?.[1] ?? description;
}

function latestStatusWord(block: string): string {
  return block.match(/<strong>(.*?)<\/strong>/)?.[1]?.trim() ?? '';
}

function mapStatusWordToIncidentStatus(word: string): Incident['status'] {
  const w = word.toLowerCase();
  if (w.includes('resolved')) return 'resolved';
  if (w.includes('identified')) return 'identified';
  if (w.includes('monitoring')) return 'monitoring';
  if (w.includes('investigating')) return 'investigating';
  return 'unknown';
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
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

// Narrative sentence is "{StatusWord} - {text}", ending before the boilerplate
// Customer Impact/Start Time/Reference Number trailer (separated by a blank line).
// Same "one clean blurb" normalization already applied to GCP's extractGcpSummary().
function extractNarrative(block: string): string {
  const afterStatusWord = block.split(/<\/strong>\s*-\s*/)[1] ?? block;
  const narrative = afterStatusWord.split(/<br\s*\/?>\s*<br\s*\/?>/)[0] ?? afterStatusWord;
  return stripHtml(narrative);
}

function extractTimestampField(description: string, label: string): string | null {
  const match = description.match(new RegExp(`<b>${label}\\s*<\\/b>:\\s*([^<]+)`, 'i'));
  if (!match) return null;
  const parsed = new Date(match[1].trim());
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function inferOciStatusLevel(narrative: string): StatusLevel {
  const lower = narrative.toLowerCase();
  if (lower.includes('outage') || lower.includes('unavailable') || lower.includes('disruption')) return 'outage';
  if (lower.includes('degrad') || lower.includes('impact') || lower.includes('latency') || lower.includes('connectivity')) return 'degraded';
  return 'degraded';
}

// OCI's region display names ("US East (Ashburn)", "Saudi Arabia West (Jeddah)") have
// no canonical slug in this feed (unlike AWS's us-east-1) — a hand-built display-name
// to canonical-slug table would need to be guessed/verified per region and kept in
// sync as Oracle adds regions, so geographic grouping is done by keyword instead.
const GEO_KEYWORDS: [string, string][] = [
  ['multiple regions', 'Global'],
  ['us ', 'North America'], ['canada', 'North America'], ['mexico', 'North America'],
  ['uk ', 'Europe'], ['united kingdom', 'Europe'], ['germany', 'Europe'], ['netherlands', 'Europe'],
  ['france', 'Europe'], ['italy', 'Europe'], ['switzerland', 'Europe'], ['sweden', 'Europe'], ['spain', 'Europe'],
  ['saudi arabia', 'Middle East'], ['uae', 'Middle East'], ['israel', 'Middle East'], ['qatar', 'Middle East'],
  ['india', 'Asia Pacific'], ['japan', 'Asia Pacific'], ['korea', 'Asia Pacific'], ['singapore', 'Asia Pacific'],
  ['australia', 'Australia'],
  ['south africa', 'Africa'],
  ['brazil', 'South America'], ['chile', 'South America'],
];

function ociRegionToGeo(regionDisplayName: string): string {
  const lower = regionDisplayName.toLowerCase();
  for (const [keyword, geo] of GEO_KEYWORDS) {
    if (lower.includes(keyword)) return geo;
  }
  return 'Global';
}

function worstStatus(statuses: StatusLevel[]): StatusLevel {
  if (statuses.includes('outage')) return 'outage';
  if (statuses.includes('degraded')) return 'degraded';
  if (statuses.includes('unknown')) return 'unknown';
  return 'operational';
}

interface ParsedOciIncident {
  id: string;
  title: string;
  incidentStatus: Incident['status'];
  statusLevel: StatusLevel;
  service: string;
  region: string;
  narrative: string;
  link: string;
  startTime: string;
  endTime: string | null;
}

function parseOciIncident(item: OciRssItem): ParsedOciIncident {
  const { service, region } = parseTitle(item.title);
  const block = latestBlock(item.description);
  const statusWord = latestStatusWord(block);
  const incidentStatus = mapStatusWordToIncidentStatus(statusWord);
  const narrative = extractNarrative(block);
  const statusLevel = incidentStatus === 'resolved' ? 'operational' : inferOciStatusLevel(narrative);
  const pubDateIso = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

  return {
    id: item.guid,
    title: `${service} — ${region}`,
    incidentStatus,
    statusLevel,
    service,
    region,
    narrative,
    link: item.link || 'https://ocistatus.oraclecloud.com/',
    startTime: extractTimestampField(item.description, 'Start Time') ?? pubDateIso,
    endTime: incidentStatus === 'resolved' ? (extractTimestampField(item.description, 'End Time') ?? pubDateIso) : null,
  };
}

export async function fetchOci(): Promise<ProviderStatus> {
  const fetchedAt = new Date().toISOString();

  const [statusResponse, rssResponse] = await Promise.all([
    fetch(OCI_STATUS_URL),
    fetch(OCI_INCIDENT_RSS_URL).catch(() => null),
  ]);

  if (!statusResponse.ok) {
    throw new Error(`OCI fetch failed: ${statusResponse.status} ${statusResponse.statusText}`);
  }

  const data: OciStatusJson = await statusResponse.json();
  const overallStatus = mapIndicatorToStatus(data.status?.indicator ?? 'none');
  const description = data.status?.description ?? 'Status unavailable';

  const rssItems = rssResponse?.ok ? parseOciRss(await rssResponse.text()) : [];
  const parsedIncidents = rssItems.map(parseOciIncident);

  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - TWENTY_FOUR_HOURS_MS;
  const activeParsed = parsedIncidents.filter((inc) => inc.incidentStatus !== 'resolved');
  const recentlyResolvedParsed = parsedIncidents.filter(
    (inc) => inc.incidentStatus === 'resolved' && new Date(inc.endTime ?? inc.startTime).getTime() >= cutoff
  );

  const regionMap = new Map<string, { serviceMap: Map<string, { serviceName: string; status: StatusLevel; incidentIds: string[] }> }>();
  for (const inc of activeParsed) {
    if (!regionMap.has(inc.region)) regionMap.set(inc.region, { serviceMap: new Map() });
    const regionEntry = regionMap.get(inc.region)!;
    const serviceId = serviceIdFor(inc.service);
    const serviceName = serviceId === MULTIPLE_SERVICES_ID ? 'Multiple Services' : inc.service;
    const existing = regionEntry.serviceMap.get(serviceId);
    if (!existing) {
      regionEntry.serviceMap.set(serviceId, { serviceName, status: inc.statusLevel, incidentIds: [inc.id] });
    } else {
      existing.incidentIds.push(inc.id);
      existing.status = worstStatus([existing.status, inc.statusLevel]);
    }
  }

  const regions: RegionStatus[] = Array.from(regionMap.entries()).map(([regionName, regionData]) => {
    const services: ServiceStatus[] = Array.from(regionData.serviceMap.entries()).map(([serviceId, svc]) => ({
      serviceId,
      serviceName: svc.serviceName,
      status: svc.status,
      incidents: svc.incidentIds,
    }));
    return {
      regionId: regionName,
      regionName,
      geographicArea: ociRegionToGeo(regionName),
      overallStatus: worstStatus(services.map((s) => s.status)),
      services,
    };
  });

  const activeIncidents: Incident[] = [
    ...activeParsed.map((inc) => ({
      id: inc.id,
      title: inc.title,
      status: inc.incidentStatus,
      severity: (inc.statusLevel === 'outage' ? 'high' : 'medium') as 'high' | 'medium',
      startTime: inc.startTime,
      endTime: null,
      affectedServices: [inc.service],
      affectedRegions: [inc.region],
      detailUrl: inc.link,
      latestUpdate: inc.narrative,
      updatedAt: fetchedAt,
    })),
    ...recentlyResolvedParsed.map((inc) => ({
      id: inc.id,
      title: inc.title,
      status: 'resolved' as const,
      severity: 'low' as const,
      startTime: inc.startTime,
      endTime: inc.endTime,
      affectedServices: [inc.service],
      affectedRegions: [inc.region],
      detailUrl: inc.link,
      latestUpdate: inc.narrative,
      updatedAt: inc.endTime ?? fetchedAt,
    })),
  ];

  // Safety net, not the primary path: whether incident-summary.rss reflects a
  // freshly-opened incident in real time (vs. only once further along) couldn't be
  // verified — no live OCI incident existed to test against. If status.json disagrees
  // with the RSS (reports non-operational while the RSS shows nothing active),
  // synthesize a single fallback incident so alerting never goes silent.
  if (overallStatus !== 'operational' && activeParsed.length === 0) {
    activeIncidents.push({
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
    });
  }

  return {
    provider: 'oci',
    displayName: 'Oracle Cloud',
    overallStatus,
    regions,
    activeIncidents,
    sourceUrl: 'https://ocistatus.oraclecloud.com/',
    dataFetchedAt: fetchedAt,
    coverageNote: overallStatus !== 'operational' ? `OCI reports: ${description}` : undefined,
  };
}
