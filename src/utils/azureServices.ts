export interface AzureServiceDef {
  id: string;
  name: string;
  keywords: string[];
}

// Canonical Azure service list for the status panel.
// keywords are matched case-insensitively against incident affectedServices strings
// (which are extracted from the first dash-segment of each Atom entry title).
export const AZURE_CRITICAL_SERVICES: AzureServiceDef[] = [
  { id: 'virtual-machines',  name: 'Virtual Machines',          keywords: ['virtual machine'] },
  { id: 'aks',               name: 'Kubernetes Service',         keywords: ['kubernetes'] },
  { id: 'entra',             name: 'Entra ID / Active Directory', keywords: ['active directory', 'entra'] },
  { id: 'storage',           name: 'Storage',                    keywords: ['storage'] },
  { id: 'sql',               name: 'SQL Database',               keywords: ['sql'] },
  { id: 'app-service',       name: 'App Service',                keywords: ['app service'] },
  { id: 'functions',         name: 'Functions',                  keywords: ['functions'] },
  { id: 'virtual-network',   name: 'Virtual Network',            keywords: ['virtual network', 'networking'] },
  { id: 'network-infrastructure', name: 'Network Infrastructure', keywords: ['network infrastructure'] },
  { id: 'key-vault',         name: 'Key Vault',                  keywords: ['key vault'] },
];
