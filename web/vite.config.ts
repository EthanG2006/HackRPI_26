import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// The API (FastAPI on :8000) is optional at runtime: every call has a browser-side fallback.
const proxy = { '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 5173, strictPort: true, proxy },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 5000, sourcemap: false },
});
