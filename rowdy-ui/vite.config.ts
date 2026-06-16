import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      includeAssets: [
        "images/rowdy-reindeer.svg",
        "images/rowdycup-logo-christmas.svg",
        "images/rowdycup-logo.svg",
        "images/stocking-stuffers.svg",
      ],
      registerType: 'prompt',
      devOptions: {
        enabled: true // Enables PWA in local dev (npm run dev)
      },
      workbox: {
        // Prevent returning index.html for files with extensions (.js, .css, .png, etc.)
        // This fixes "text/html is not a valid JavaScript MIME type" errors after deployments
        navigateFallbackDenylist: [/\.[a-z0-9]+$/i],
        // Clean up old precaches when new SW activates
        cleanupOutdatedCaches: true,
        // Runtime caching for external resources (team logos, etc.)
        runtimeCaching: [
          {
            // Cache Firebase Storage images (team logos, tournament logos)
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'firebase-images',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: {
                maxEntries: 20,
                maxAgeSeconds: 365 * 24 * 60 * 60, // 1 year
              },
            },
          },
        ],
      },
      manifest: {
        name: 'Rowdy Cup',
        short_name: 'Rowdy Cup',
        description: 'Live scoring for the Rowdy Cup tournament',
        id: '/',
        lang: 'en',
        categories: ['sports'],
        theme_color: '#132448', // brand navy — matches the header gradient
        background_color: '#f6f6f6', // matches --app-bg
        display: 'standalone', // Hides browser UI
        orientation: 'portrait', // mobile-only scoring app; scorecard scrolls horizontally in portrait
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable', // Required for "Adaptive Icons" on Android
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Split *stable* vendor code into its own long-lived chunks so that
        // shipping app changes doesn't bust their cache. The object form used
        // to miss `react-dom/client` (the actual 500KB renderer), which then
        // rode along in the app `index` chunk and got re-downloaded on every
        // deploy. The function form matches by resolved module path, so it
        // catches all entry points of each package.
        //
        // Only well-known, eagerly-used vendors are pinned here. Everything
        // else returns undefined so Rollup keeps lazy-route-only deps inside
        // their own lazy chunk (don't force them eager).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // React core (incl. react-dom/client) + its scheduler
          if (/node_modules\/(react-dom|react|scheduler)\//.test(id)) return 'react-vendor';
          // Router changes rarely; keep it cacheable on its own
          if (id.includes('node_modules/react-router')) return 'router';
          // Firebase SDK (~130KB gzip) - rarely changes
          if (/node_modules\/(@firebase|firebase|idb)\//.test(id)) return 'firebase';
          // clsx + tailwind-merge back the `cn()` helper used app-wide; eager
          // and stable, so cache them apart from app code.
          if (/node_modules\/(tailwind-merge|clsx|class-variance-authority)\//.test(id)) return 'ui-vendor';
          return undefined;
        },
      },
    },
  },
});