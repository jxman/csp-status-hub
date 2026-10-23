import type { Provider } from '../types/status';

// Per-provider pages (/aws, /azure, /gcp, /oci) filter the dashboard to one
// provider; / shows all four. The static HTML for each provider page (head
// tags, crawler text) is generated at build time from src/seo/providerPages.ts.
export const PROVIDER_PAGE_SLUGS: Provider[] = ['aws', 'azure', 'gcp', 'oci'];

export const PROVIDER_LABELS: Record<Provider, string> = {
  aws: 'AWS',
  azure: 'Azure',
  gcp: 'GCP',
  oci: 'OCI',
};

// Plain-text page titles, also used for document.title when the filter is
// switched without a reload. Must match the <title> each page is built with.
export const HOME_TITLE = 'AWS, Azure, Google Cloud & OCI Status | Cloud Status Hub';
export const PROVIDER_PAGE_TITLES: Record<Provider, string> = {
  aws: 'Is AWS Down? Live AWS Status & Outages | Cloud Status Hub',
  azure: 'Is Azure Down? Live Azure Status & Outages | Cloud Status Hub',
  gcp: 'Is Google Cloud Down? Live GCP Status | Cloud Status Hub',
  oci: 'Is Oracle Cloud Down? Live OCI Status | Cloud Status Hub',
};

export function providerPagePath(provider: Provider | null): string {
  return provider ? `/${provider}` : '/';
}

/**
 * The provider the page is filtered to, or null on the all-providers dashboard.
 * Takes the path rather than reading window.location: this file is also
 * imported by the build (vite.config.ts via src/seo), which has no DOM.
 */
export function getFocusProvider(pathname: string): Provider | null {
  const slug = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  return PROVIDER_PAGE_SLUGS.includes(slug as Provider) ? (slug as Provider) : null;
}
