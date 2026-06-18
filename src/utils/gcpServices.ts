export interface GcpServiceDef {
  id: string;
  name: string;
  // GCP's stable, permanent product ID — verified against https://status.cloud.google.com/products.json
  // (the authoritative product catalog). Confirmed identical to the IDs incidents.json reports for the
  // same product, so this is the primary match.
  productId: string;
  // Fallback match against the product title, in case GCP ever changes a productId.
  keywords: string[];
}

export const GCP_CRITICAL_SERVICES: GcpServiceDef[] = [
  { id: 'compute-engine',    name: 'Compute Engine',              productId: 'L3ggmi3Jy4xJmgodFA9K', keywords: ['compute engine'] },
  { id: 'cloud-console',     name: 'Cloud Console',               productId: 'Wdsr1n5vyDvCt78qEifm', keywords: ['cloud console'] },
  { id: 'kubernetes-engine', name: 'Kubernetes Engine',           productId: 'LCSbT57h59oR4W98NHuz', keywords: ['kubernetes'] },
  { id: 'cloud-storage',     name: 'Cloud Storage',               productId: 'UwaYoXQ5bHYHG6EdiPB8', keywords: ['cloud storage'] },
  { id: 'cloud-sql',         name: 'Cloud SQL',                   productId: 'hV87iK5DcEXKgWU2kDri', keywords: ['cloud sql'] },
  { id: 'cloud-functions',   name: 'Cloud Functions',             productId: 'oW4vJ7VNqyxTWNzSHopX', keywords: ['cloud functions'] },
  { id: 'iam',               name: 'Cloud IAM & Admin',           productId: 'adnGEDEt9zWzs8uF1oKA', keywords: ['identity and access management', 'iam'] },
  { id: 'vpc',               name: 'Virtual Private Cloud (VPC)', productId: 'BSGtCUnz6ZmyajsjgTKv', keywords: ['virtual private cloud', 'vpc'] },
  { id: 'cloud-dns',         name: 'Cloud DNS',                   productId: 'TUZUsWSJUVJGW97Jq2sH', keywords: ['cloud dns'] },
  { id: 'cloud-monitoring',  name: 'Cloud Monitoring',            productId: '3zaaDb7antc73BM1UAVT', keywords: ['monitoring'] },
];
