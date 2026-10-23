import type { Provider } from '../types/status';

// Per-provider landing pages (/aws, /azure, /gcp, /oci). Each serves the same
// dashboard with that provider shown first; the static HTML for each is
// generated at build time from src/seo/providerPages.ts.
export const PROVIDER_PAGE_SLUGS: Provider[] = ['aws', 'azure', 'gcp', 'oci'];

export function providerPagePath(provider: Provider): string {
  return `/${provider}`;
}

/** The provider whose landing page is open, or null on the main dashboard. */
export function getFocusProvider(pathname = window.location.pathname): Provider | null {
  const slug = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  return PROVIDER_PAGE_SLUGS.includes(slug as Provider) ? (slug as Provider) : null;
}
