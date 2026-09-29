// Rename detection for check-status.ts's incident diff.
//
// check-status.ts treats an id that vanished since the last poll as
// resolved and an unfamiliar id as new. That's wrong when a provider edits
// an ongoing incident in a way that changes the id we derive for it —
// Azure's feed has no stable incident id, so azureFetcher.ts fingerprints
// its <category> tags (or title), and on 2026-09-29 Microsoft retitled a
// live incident and swapped its category mid-incident. The id changed, and
// subscribers got a false "resolved" + "new incident" pair for one event.
//
// A vanished id and a new id from the same provider, in the same poll, with
// the same startTime are treated as one incident renamed. startTime is the
// provider's own impact-start time (Azure's item pubDate, e.g. 10:00 UTC for
// an incident first published at 13:42), so it describes the incident, not
// the wording, and survives headline edits. A pair only counts when the
// startTime is unambiguous on both sides — if two vanished or two new
// incidents share it, none of them are paired and they fall through to the
// normal resolved/new handling.

import type { Incident } from '../../src/types/status.js';

export interface IncidentRename {
  fromId: string;
  toId: string;
}

function startKey(incident: Incident | undefined): number | null {
  if (!incident?.startTime) return null;
  const ms = new Date(incident.startTime).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function groupByStart(ids: string[], lookup: Record<string, Incident>): Map<number, string[]> {
  const groups = new Map<number, string[]>();
  for (const id of ids) {
    const key = startKey(lookup[id]);
    if (key === null) continue;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return groups;
}

export function matchRenamedIncidents(
  resolvedIds: string[],
  newIds: string[],
  previousSnapshots: Record<string, Incident>,
  currentSnapshots: Record<string, Incident>
): IncidentRename[] {
  const vanished = groupByStart(resolvedIds, previousSnapshots);
  const appeared = groupByStart(newIds, currentSnapshots);
  const renames: IncidentRename[] = [];
  for (const [key, fromIds] of vanished) {
    const toIds = appeared.get(key);
    if (fromIds.length === 1 && toIds?.length === 1) {
      renames.push({ fromId: fromIds[0], toId: toIds[0] });
    }
  }
  return renames;
}
