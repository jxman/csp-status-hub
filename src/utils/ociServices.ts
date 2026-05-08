// OCI canonical service list for display.
// OCI's public API returns only overall status (no per-service breakdown),
// so these are shown with the provider's overall status when there's an incident.
export const OCI_CRITICAL_SERVICES = [
  { id: 'compute', name: 'Compute' },
  { id: 'console', name: 'OCI Console' },
  { id: 'oke', name: 'Container Engine (OKE)' },
  { id: 'monitoring', name: 'Monitoring' },
  { id: 'object-storage', name: 'Object Storage' },
  { id: 'database', name: 'Database' },
  { id: 'functions', name: 'Functions' },
  { id: 'identity', name: 'Identity & Access' },
  { id: 'vcn', name: 'Virtual Cloud Network' },
  { id: 'dns', name: 'DNS' },
];
