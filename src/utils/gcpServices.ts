export const GCP_SERVICE_NAMES: Record<string, string> = {
  'google-compute-engine': 'Compute Engine',
  'google-cloud-console': 'Cloud Console',
  'google-kubernetes-engine': 'Kubernetes Engine',
  'google-cloud-monitoring': 'Cloud Monitoring',
  'google-cloud-storage': 'Cloud Storage',
  'cloud-sql': 'Cloud SQL',
  'google-cloud-functions': 'Cloud Functions',
  'cloud-run': 'Cloud Run',
  'google-cloud-iam': 'Cloud IAM & Admin',
  'google-cloud-networking': 'Cloud Networking',
  'google-cloud-dns': 'Cloud DNS',
  'bigquery': 'BigQuery',
  'google-cloud-dataflow': 'Dataflow',
  'google-cloud-pubsub': 'Pub/Sub',
  'google-cloud-spanner': 'Cloud Spanner',
  'google-cloud-bigtable': 'Bigtable',
  'google-cloud-datastore': 'Cloud Datastore',
  'google-cloud-memorystore': 'Memorystore',
  'google-cloud-armor': 'Cloud Armor',
  'google-cloud-load-balancing': 'Cloud Load Balancing',
  'google-cloud-build': 'Cloud Build',
  'google-cloud-artifact-registry': 'Artifact Registry',
  'vertex-ai': 'Vertex AI',
};

export const GCP_CRITICAL_SERVICE_IDS = [
  'google-compute-engine',
  'google-cloud-console',
  'google-kubernetes-engine',
  'google-cloud-monitoring',
  'google-cloud-storage',
  'cloud-sql',
  'google-cloud-functions',
  'google-cloud-iam',
  'google-cloud-networking',
  'google-cloud-dns',
];

// For flat display when no incidents are active
export const GCP_CRITICAL_SERVICES = GCP_CRITICAL_SERVICE_IDS.map((id) => ({
  id,
  name: GCP_SERVICE_NAMES[id] ?? id,
}));
