import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Front back-office du parapheur (gestion des parapheurs). Le front public DMZ
// est un projet distinct (../frontend-dmz).
export default defineConfig({
  plugins: [react()],
  // Pré-bundle pdfjs-dist (sinon « Outdated Optimize Dep » au 1er import à chaud).
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: { format: 'es' },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      '/storage': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
})
