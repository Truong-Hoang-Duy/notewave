import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
