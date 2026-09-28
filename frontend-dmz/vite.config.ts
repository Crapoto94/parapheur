import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports dev surchargeables : VITE_PORT (défaut 3006), VITE_BACKEND_URL (défaut
// http://127.0.0.1:3004).
const DEV_PORT = Number(process.env.VITE_PORT) || 3006
const BACKEND_URL = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:3004'

export default defineConfig({
  plugins: [react()],
  // Pré-bundle pdfjs-dist (sinon « Outdated Optimize Dep » au 1er import à chaud)
  // et force le worker au format ES (import `?worker&inline` dans utils/pdfjs.ts).
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: { format: 'es' },
  server: {
    port: DEV_PORT,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
})
