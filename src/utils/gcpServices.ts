export interface GcpServiceDef {
  id: string;
  name: string;
  keywords: string[];
}

// GCP's incidents.json assigns each affected product a random opaque doc ID that is
// NOT a stable slug (e.g. "BSGtCUnz6ZmyajsjgTKv" for VPC), so canonical services must
// be matched by title keyword instead of ID — same approach as azureServices.ts.
export const GCP_CRITICAL_SERVICES: GcpServiceDef[] = [
  { id: 'compute-engine',    name: 'Compute Engine',              keywords: ['compute engine'] },
  { id: 'cloud-console',     name: 'Cloud Console',               keywords: ['cloud console'] },
  { id: 'kubernetes-engine', name: 'Kubernetes Engine',           keywords: ['kubernetes'] },
  { id: 'cloud-storage',     name: 'Cloud Storage',               keywords: ['cloud storage'] },
  { id: 'cloud-sql',         name: 'Cloud SQL',                   keywords: ['cloud sql'] },
  { id: 'cloud-functions',   name: 'Cloud Functions',             keywords: ['cloud functions'] },
  { id: 'iam',               name: 'Cloud IAM & Admin',           keywords: ['identity and access management', 'iam'] },
  { id: 'vpc',               name: 'Virtual Private Cloud (VPC)', keywords: ['virtual private cloud', 'vpc'] },
  { id: 'cloud-dns',         name: 'Cloud DNS',                   keywords: ['cloud dns'] },
  { id: 'cloud-monitoring',  name: 'Cloud Monitoring',            keywords: ['monitoring'] },
];
