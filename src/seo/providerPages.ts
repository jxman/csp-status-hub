import { PROVIDER_PAGE_TITLES } from '../utils/providerPages';

// Head tags and static fallback content for the per-provider landing pages.
// Only imported by vite.config.ts, which writes dist/<slug>.html from the
// built index.html with these swapped in — none of this ships in the JS bundle.
// The fallback is what crawlers that don't run JavaScript read; React replaces
// it on mount, same as the homepage's.

export const SITE_URL = 'https://cloudstatus.synepho.com';

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface ProviderPage {
  slug: 'aws' | 'azure' | 'gcp' | 'oci';
  title: string; // HTML-escaped
  description: string;
  fallbackHtml: string;
}

const OTHER_PAGES = (slug: ProviderPage['slug']) =>
  [
    { slug: 'aws', label: 'AWS status' },
    { slug: 'azure', label: 'Azure status' },
    { slug: 'gcp', label: 'Google Cloud status' },
    { slug: 'oci', label: 'Oracle Cloud status' },
  ]
    .filter((p) => p.slug !== slug)
    .map((p) => `<a href="/${p.slug}">${p.label}</a>`)
    .join(' · ');

const commonFooter = (slug: ProviderPage['slug'], providerName: string) => `
        <h2>Email alerts for ${providerName}</h2>
        <p>
          <a href="/?subscribe=1&amp;provider=${slug}">Sign up for free email alerts</a> and get one
          email when ${providerName} posts a new incident and another when it resolves. You can add
          the other providers too, and you don't need an account.
        </p>

        <h2>Other cloud providers</h2>
        <p>
          <a href="/">All four providers on one dashboard</a> · ${OTHER_PAGES(slug)}
        </p>
        <p>Cloud Status Hub is not affiliated with Amazon, Microsoft, Google, or Oracle.</p>`;

export const PROVIDER_PAGES: ProviderPage[] = [
  {
    slug: 'aws',
    title: escapeHtml(PROVIDER_PAGE_TITLES.aws),
    description:
      'Is AWS down right now? Live Amazon Web Services status with active outages by region and service, refreshed every minute, plus free email alerts.',
    fallbackHtml: `
        <h1>Is AWS down? Live AWS status</h1>
        <p>
          Current status for Amazon Web Services, with active outages and incidents grouped by
          region and service. The page refreshes every minute, so a new AWS incident shows up
          without reloading. Each active incident also gets an AI-generated technical and
          executive brief.
        </p>

        <h2>Where the AWS data comes from</h2>
        <p>
          Status comes from the public RSS feed behind the
          <a href="https://health.aws.amazon.com/health/status">AWS Health Dashboard</a>.
          AWS posts each update to an incident as a separate entry, so Cloud Status Hub groups the
          updates and shows the latest one for each incident. Global services such as CloudFront,
          Route 53, and IAM are listed under "global" rather than a single region.
        </p>

        <h2>Why AWS can show healthy while you're having problems</h2>
        <p>
          The public dashboard only lists incidents AWS chooses to announce publicly, usually
          significant or widespread ones. Smaller problems that affect a single service, or only
          some accounts, often appear only in AWS Health in your own AWS console.
        </p>
${commonFooter('aws', 'AWS')}`,
  },
  {
    slug: 'azure',
    title: escapeHtml(PROVIDER_PAGE_TITLES.azure),
    description:
      'Is Microsoft Azure down right now? Live Azure status with active outages by region and service, refreshed every minute, plus free email alerts.',
    fallbackHtml: `
        <h1>Is Azure down? Live Microsoft Azure status</h1>
        <p>
          Current status for Microsoft Azure, with active outages and incidents by region and
          service. The page refreshes every minute, so a new Azure incident shows up without
          reloading. Each active incident also gets an AI-generated technical and executive brief.
        </p>

        <h2>Where the Azure data comes from</h2>
        <p>
          Status comes from the public RSS feed behind the
          <a href="https://azure.status.microsoft/">Azure status page</a>. The feed describes each
          incident in free text, so Cloud Status Hub reads the affected regions and services out of
          it. Microsoft removes an incident from the feed as soon as it ends; Cloud Status Hub
          keeps it under "Recently resolved" for 24 hours.
        </p>

        <h2>Why Azure can show healthy while you're having problems</h2>
        <p>
          Microsoft's public status page only covers incidents with broad impact across multiple
          services or regions, or times when the Azure portal itself is unavailable. Problems that
          affect only your subscriptions are reported in Azure Service Health in the Azure portal.
        </p>
${commonFooter('azure', 'Azure')}`,
  },
  {
    slug: 'gcp',
    title: escapeHtml(PROVIDER_PAGE_TITLES.gcp),
    description:
      'Is Google Cloud down right now? Live GCP status with active outages by product and location, refreshed every minute, plus free email alerts.',
    fallbackHtml: `
        <h1>Is Google Cloud down? Live GCP status</h1>
        <p>
          Current status for Google Cloud Platform, with active outages and incidents by product
          and location. The page refreshes every minute, so a new Google Cloud incident shows up
          without reloading. Each active incident also gets an AI-generated technical and
          executive brief.
        </p>

        <h2>Where the Google Cloud data comes from</h2>
        <p>
          Status comes from the incidents feed behind
          <a href="https://status.cloud.google.com/">Google Cloud Service Health</a>. Google lists
          the affected products and locations for every incident, so the region-by-service view is
          exact rather than inferred. Each incident shows Google's latest description of the
          problem and its recovery progress.
        </p>

        <h2>Why Google Cloud can show healthy while you're having problems</h2>
        <p>
          Google Cloud Service Health lists incidents Google has confirmed and announced. Problems
          limited to your own projects appear in Personalized Service Health in the Google Cloud
          console.
        </p>
${commonFooter('gcp', 'Google Cloud')}`,
  },
  {
    slug: 'oci',
    title: escapeHtml(PROVIDER_PAGE_TITLES.oci),
    description:
      'Is Oracle Cloud (OCI) down right now? Live OCI status with active outages by region and service, refreshed every minute, plus free email alerts.',
    fallbackHtml: `
        <h1>Is Oracle Cloud down? Live OCI status</h1>
        <p>
          Current status for Oracle Cloud Infrastructure (OCI), with active outages and incidents
          by region and service. The page refreshes every minute, so a new OCI incident shows up
          without reloading. Each active incident also gets an AI-generated technical and
          executive brief.
        </p>

        <h2>Where the OCI data comes from</h2>
        <p>
          Status comes from the public <a href="https://ocistatus.oraclecloud.com/">OCI status
          page</a>: its overall status, plus its incident feed for the affected regions and
          services. It covers Oracle's commercial regions; US Government regions have a separate
          status page and aren't included.
        </p>

        <h2>Why OCI can show healthy while you're having problems</h2>
        <p>
          The public status page lists incidents Oracle has announced. Problems limited to your
          own tenancy are reported through announcements and notifications in the OCI Console.
        </p>
${commonFooter('oci', 'OCI')}`,
  },
];
