import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { PROVIDER_PAGES, SITE_URL } from './src/seo/providerPages'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const buildDate = new Date().toISOString()

// Emits dist/sitemap.xml (see below) and dist/version.json from the same buildDate baked into the bundle as
// __BUILD_DATE__ (single source of truth, computed once above), so a running
// tab's useVersionCheck hook can fetch this file and detect it's on a stale
// bundle from before the latest deploy — see src/hooks/useVersionCheck.ts.
function versionMarkerPlugin(): Plugin {
  return {
    name: 'version-marker',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildDate }) })
      // Sitemap lastmod tracks the deploy rather than a hand-edited date that
      // goes stale. changefreq/priority are omitted: Google ignores both.
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${['/', ...PROVIDER_PAGES.map((p) => `/${p.slug}`)]
  .map((path) => `  <url>
    <loc>${SITE_URL}${path}</loc>
    <lastmod>${buildDate.slice(0, 10)}</lastmod>
  </url>`)
  .join('\n')}
</urlset>
`,
      })
    },
  }
}

// Replaces exactly one match of `pattern` in `html`, failing the build when
// index.html's markup has drifted so a provider page can't silently ship with
// the homepage's title or canonical URL.
function replaceOnce(html: string, pattern: RegExp, replacement: string, label: string): string {
  const matches = html.match(new RegExp(pattern.source, 'g')) ?? []
  if (matches.length !== 1) {
    throw new Error(`provider-pages: expected 1 match for ${label} in index.html, found ${matches.length}`)
  }
  return html.replace(pattern, () => replacement)
}

// Writes dist/<slug>.html for each per-provider landing page (/aws → aws.html
// via vercel.json), copied from the built index.html with that provider's
// title, description, canonical URL and crawler fallback content swapped in.
// Same JS bundle; the app reads the path and shows that provider first.
function providerPagesPlugin(): Plugin {
  return {
    name: 'provider-pages',
    apply: 'build',
    writeBundle(options, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') throw new Error('provider-pages: index.html missing from bundle')
      const base = String(index.source)
      const mainOpen = base.match(/<main[^>]*>/)?.[0] ?? '<main>'

      for (const page of PROVIDER_PAGES) {
        const url = `${SITE_URL}/${page.slug}`
        let html = base
        html = replaceOnce(html, /<title>[^<]*<\/title>/, `<title>${page.title}</title>`, 'title')
        html = replaceOnce(html, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${page.description}" />`, 'description')
        html = replaceOnce(html, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`, 'canonical')
        html = replaceOnce(html, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`, 'og:url')
        html = replaceOnce(html, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${page.title}" />`, 'og:title')
        html = replaceOnce(html, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${page.description}" />`, 'og:description')
        html = replaceOnce(html, /<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${page.title}" />`, 'twitter:title')
        html = replaceOnce(html, /<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${page.description}" />`, 'twitter:description')
        html = replaceOnce(html, /<main[^>]*>[\s\S]*?<\/main>/, `${mainOpen}${page.fallbackHtml}\n      </main>`, 'fallback <main>')
        writeFileSync(join(options.dir ?? 'dist', `${page.slug}.html`), html)
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), versionMarkerPlugin(), providerPagesPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
})
