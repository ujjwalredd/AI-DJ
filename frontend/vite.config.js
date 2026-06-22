import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + cached audio to the Express backend on :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/audio': 'http://localhost:3000',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1100 },
});
