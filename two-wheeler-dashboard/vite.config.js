import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Served as a sub-app of the PV dashboard at /2w/ (single Cloudflare
  // Worker hosts both sister dashboards). Absolute base so deep assets
  // resolve to /2w/assets/* regardless of the URL the user landed on.
  base: '/2w/',
  build: {
    // Emit straight into the PV repo root at /2w/ so the existing
    // static-serving Worker (directory = ".") picks it up — no separate
    // deploy. emptyOutDir lets Vite clean a dir outside its own root.
    outDir: '../2w',
    emptyOutDir: true,
    // Modern browsers only — skips legacy polyfills and shaves ~25% off
    // build time. Cloudflare's audience is desktop dashboards, so safe.
    target: 'es2022',
    // Stable, hash-named vendor chunks let Cloudflare's CDN cache the
    // big libraries across deploys; only the small app chunk re-uploads.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          recharts: ['recharts'],
        },
      },
    },
    // Quieten the 'chunk > 500KB' warning now that we've split things.
    chunkSizeWarningLimit: 800,
  },
})
