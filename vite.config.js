import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Vendored dependencies, grouped into chunks of their own.
 *
 * The win here is not a smaller first load — the same bytes cross the wire
 * either way — it is what an UPDATE costs. Left in one bundle, editing a string
 * in App.jsx changes that chunk's hash and the browser re-downloads React,
 * Leaflet and framer-motion along with it. Split out, a code change invalidates
 * the app chunk alone: roughly 60 kB gzip instead of 185, on a metered phone
 * connection in Lahore.
 *
 * The three tests are mutually exclusive. `react` cannot match `react-leaflet`
 * or `@react-leaflet`, because the character after "react" has to be a path
 * separator — so no group can claim another's modules and the order they appear
 * in does not matter.
 *
 * What this deliberately does NOT do is silence Vite's 500 kB warning. `three`
 * (~538 kB, behind React.lazy in LiquidEther) stays over the line, and that is
 * the honest outcome: `three` genuinely is that large and is already off the
 * critical path, so raising `chunkSizeWarningLimit` to hide it would suppress
 * the one oversize number still worth watching.
 */
const VENDOR_CHUNKS = [
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
  { name: 'leaflet', test: /node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/ },
  { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // Rolldown's replacement for Rollup's `manualChunks`, which it now
        // rejects outright. `rollupOptions` is likewise deprecated in Vite 8.
        codeSplitting: { groups: VENDOR_CHUNKS },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.jsx'],
    include: ['tests/unit/**/*.test.{js,jsx}', 'tests/component/**/*.test.{js,jsx}'],
    css: false,
    restoreMocks: true,
    clearMocks: true,
  },
})
