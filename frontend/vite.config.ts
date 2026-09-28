import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Front back-office du parapheur (gestion des parapheurs). Le front public DMZ
// est un projet distinct (../frontend-dmz).
// Ports dev surchargeables : VITE_PORT (défaut 3005), VITE_BACKEND_URL (défaut
// http://127.0.0.1:3004) pour joindre le backend lancé en local.
const DEV_PORT = Number(process.env.VITE_PORT) || 3005
const BACKEND_URL = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:3004'

export default defineConfig({
  plugins: [react()],
  // Pré-bundle pdfjs-dist (sinon « Outdated Optimize Dep » au 1er import à chaud).
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  worker: { format: 'es' },
  server: {
    host: true,
    port: DEV_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
      '/storage': {
        target: BACKEND_URL,
        changeOrigin: true,
      },
    },
  },
})
