import type { Incident, Provider } from '../types/status';

export interface PastIncident {
  provider: Provider;
  incident: Incident;
  // Latest complete AI brief for this incident, or null if none was generated.
  briefId: string | null;
}

export interface PastIncidentsPage {
  retentionDays: number;
  incidents: PastIncident[];
  nextCursor: string | null;
}

// Incidents resolved 24h–90d ago (see api/incidents/history.ts). Only called
// when the "Past incidents" section is expanded — never on page load or poll.
export async function fetchPastIncidents(cursor?: string | null): Promise<PastIncidentsPage> {
  const url = cursor ? `/api/incidents/history?cursor=${encodeURIComponent(cursor)}` : '/api/incidents/history';
  const response = await fetch(url);
  const text = await response.text();

  // Vite's dev server answers unknown /api/* routes with index.html.
  if (text.trimStart().startsWith('<')) {
    throw new Error('Past incidents require the Vercel functions — run `vercel dev` locally.');
  }
  if (!response.ok) {
    throw new Error(`Request to ${url} returned ${response.status} ${response.statusText}`);
  }
  return JSON.parse(text) as PastIncidentsPage;
}
