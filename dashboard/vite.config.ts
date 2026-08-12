import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // In production build, VITE_API_BASE should be the full API URL.
  // e.g. https://api.flamboyai.com
  // In dev, we fall back to the proxy path so /api routes to localhost:3000.
  const apiBase = env.VITE_API_BASE || ''

  // Dev proxy target — only used during `vite dev`, not in production builds
  const proxyTarget = env.VITE_API_TARGET || env.VITE_API_BASE || 'http://127.0.0.1:3000'

  return {
    plugins: [react()],

    define: {
      // Injected at build time — frontend reads this as API_BASE
      __API_BASE__: JSON.stringify(apiBase || '/api'),
    },

    build: {
      // Don't inline sourcemaps in production bundle — keeps bundle smaller
      sourcemap: false,
      // Chunk size warning at 600kb (raised from default 500kb for our analytics bundle)
      chunkSizeWarningLimit: 600,
    },

    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})
