import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Pré-bundle pdfjs-dist (sinon « Outdated Optimize Dep » au 1er import à chaud)
  // et force le worker au format ES (import `?worker&inline` dans utils/pdfjs.ts).
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: { format: 'es' },
  server: {
    port: 5177,
    strictPort: true,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
