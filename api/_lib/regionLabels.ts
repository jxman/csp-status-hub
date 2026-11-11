import type { Provider, RegionStatus } from '../../src/types/status.js';
import { AWS_REGION_NAMES } from '../../src/utils/awsRegions.js';

// Region labels for alert emails: the short code subscribers see in provider
// consoles plus the human name, e.g. "ap-northeast-1 – Asia Pacific (Tokyo)",
// so readers who don't know region codes by heart still know where it is.
//
// - AWS: code from the feed GUID, name from AWS_REGION_NAMES.
// - GCP: the feed's own location title already carries both
//   ("Iowa (us-central1)"), so it's used as-is.
// - Azure/OCI: the feed only gives display names ("East US",
//   "US East (Ashburn)"), so there's no code to add.
//
// Idempotent: a value that's already a label (or has no known name) comes
// back unchanged. That matters because check-status.ts re-labels regions
// read back from older Redis snapshots, which stored raw codes.
export function regionLabel(provider: Provider, regionId: string, feedName?: string): string {
  if (regionId.toLowerCase() === 'global') return regionId;
  const name = feedName ?? (provider === 'aws' ? AWS_REGION_NAMES[regionId] : undefined);
  if (!name || name === regionId) return regionId;
  if (name.includes(regionId)) return name;
  return `${regionId} – ${name}`;
}

export function regionLabels(provider: Provider, regionIds: string[], regions: RegionStatus[] = []): string[] {
  const namesById = new Map(regions.map((r) => [r.regionId, r.regionName]));
  return regionIds.map((id) => regionLabel(provider, id, namesById.get(id)));
}
