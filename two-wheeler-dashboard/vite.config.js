import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
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
