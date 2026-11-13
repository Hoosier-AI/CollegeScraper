import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// STATS_API=https://www.plaibook.live npm run dev: work on the UI against the live site's reads, no local server needed.
const target = process.env.STATS_API ?? 'http://localhost:8080';
const proxy = { target, changeOrigin: true, secure: true };

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, proxy: { '/api': proxy, '/health': proxy } },
  build: { outDir: 'dist', emptyOutDir: true },
});
