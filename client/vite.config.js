import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        name: 'NoteWave — Ghi chú & Phụ đề thông minh',
        short_name: 'NoteWave',
        description: 'Ghi chú và phụ đề cuộc họp bằng giọng nói theo thời gian thực, ghi chú Cornell.',
        theme_color: '#2f6554',
        background_color: '#f6f4ef',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        lang: 'vi',
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
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // KaTeX dùng ở cả 2 chunk lazy (Ghi chú + phiên Quét tài liệu) -> tách chunk riêng, tải 1 lần, không nhúng lặp.
          groups: [{ name: 'katex', test: /node_modules[\\/]katex[\\/]/ }],
        },
      },
    },
  },
  server: {
    open: true,
    // Dev local: gọi /api/... sẽ được chuyển tới FastAPI, không cần VITE_API_BASE_URL.
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
