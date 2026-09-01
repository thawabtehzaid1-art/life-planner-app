import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// One timestamp, computed once per build invocation, used as this build's
// version stamp both inside the JS bundle (via `define`, so the running
// app knows what it currently is) and as a small static version.json file
// (so a running app can ask the server what's *currently deployed* and
// compare) — see useVersionCheck.js. Needed because iOS caches home-screen
// web apps aggressively enough that HTTP cache headers alone don't
// reliably make a relaunched app fetch a new build; polling and an
// explicit "update available" prompt works regardless of what iOS decided
// to cache.
const buildVersion = String(Date.now())

function versionFilePlugin() {
  return {
    name: 'version-file',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: buildVersion }),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), versionFilePlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion),
  },
  server: {
    // Allows access via the LAN IP and any Cloudflare quick-tunnel URL
    // (a fresh random *.trycloudflare.com subdomain each time it's
    // started) for testing on a phone without deploying anywhere yet.
    allowedHosts: [".trycloudflare.com"],
  },
})
