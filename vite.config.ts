import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
  <url>
    <loc>https://cloudstatus.synepho.com/</loc>
    <lastmod>${buildDate.slice(0, 10)}</lastmod>
  </url>
</urlset>
`,
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), versionMarkerPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
})
