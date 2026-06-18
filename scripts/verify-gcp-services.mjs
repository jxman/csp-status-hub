// Verifies the canonical GCP_CRITICAL_SERVICES list in src/utils/gcpServices.ts still
// resolves against GCP's live, authoritative product catalog. Run this periodically
// (e.g. after GCP renames/reorganizes a product) to catch a stale productId before
// it silently falls through to keyword matching or stops matching entirely.
//
// Usage: npm run verify:gcp

// Keep this list in sync with GCP_CRITICAL_SERVICES in src/utils/gcpServices.ts.
const CANONICAL_SERVICES = [
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

const PRODUCTS_URL = 'https://status.cloud.google.com/products.json';

const res = await fetch(PRODUCTS_URL);
if (!res.ok) {
  console.error(`Failed to fetch ${PRODUCTS_URL}: ${res.status} ${res.statusText}`);
  process.exit(1);
}
const { products } = await res.json();
const byId = new Map(products.map((p) => [p.id, p.title]));
const byKeyword = (kw) => products.filter((p) => p.title.toLowerCase().includes(kw));

let failures = 0;
for (const def of CANONICAL_SERVICES) {
  const catalogTitle = byId.get(def.productId);
  if (catalogTitle) {
    console.log(`OK    ${def.name.padEnd(28)} productId resolves to "${catalogTitle}"`);
  } else {
    failures++;
    console.error(`STALE ${def.name.padEnd(28)} productId ${def.productId} not found in catalog`);
    const candidates = def.keywords.flatMap(byKeyword);
    if (candidates.length > 0) {
      console.error(`        keyword fallback would still match: ${candidates.map((c) => `${c.title} (${c.id})`).join(', ')}`);
    } else {
      console.error('        keyword fallback ALSO finds nothing — this service would silently stop being tracked');
    }
  }
}

console.log(`\n${CANONICAL_SERVICES.length - failures}/${CANONICAL_SERVICES.length} canonical services verified against ${products.length} live GCP products.`);
process.exit(failures > 0 ? 1 : 0);
