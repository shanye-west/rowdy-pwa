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
      registerType: 'autoUpdate',
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
        short_name: 'RowdyCup',
        description: 'Live scoring for the Rowdy Cup tournament',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone', // Hides browser UI
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
        // Split vendor chunks for better caching
        manualChunks: {
          // Firebase SDK in its own chunk (~300KB) - rarely changes
          firebase: [
            'firebase/app',
            'firebase/auth', 
            'firebase/firestore',
          ],
          // React ecosystem in its own chunk
          'react-vendor': [
            'react',
            'react-dom',
            'react-router-dom',
          ],
        },
      },
    },
  },
});