export interface OciServiceDef {
  id: string;
  name: string;
  // incident-summary.rss gives free-text service names/categories, not a clean enum
  // like AWS's slugs — matched against these keywords, GCP-productId-style but
  // title-only since OCI's feed has no stable per-product id.
  keywords: string[];
}

// OCI canonical service list for display. Used two ways: as a static "all clear" flat
// list when there's no incident, and (via RegionTable.tsx's buildOciServiceList) to
// classify incident-summary.rss's free-text service names when there is one.
export const OCI_CRITICAL_SERVICES: OciServiceDef[] = [
  { id: 'compute', name: 'Compute', keywords: ['compute'] },
  { id: 'console', name: 'OCI Console', keywords: ['console'] },
  { id: 'oke', name: 'Container Engine (OKE)', keywords: ['container engine', 'oke', 'kubernetes'] },
  { id: 'monitoring', name: 'Monitoring', keywords: ['monitoring'] },
  { id: 'object-storage', name: 'Object Storage', keywords: ['object storage', 'storage'] },
  { id: 'database', name: 'Database', keywords: ['database'] },
  { id: 'functions', name: 'Functions', keywords: ['functions'] },
  { id: 'identity', name: 'Identity & Access', keywords: ['identity', 'iam'] },
  { id: 'vcn', name: 'Virtual Cloud Network', keywords: ['virtual cloud network', 'vcn', 'networking', 'network'] },
  { id: 'dns', name: 'DNS', keywords: ['dns'] },
];
