import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // changeOrigin rewrites Host to the API's loopback address so the
      // server's Host check accepts proxied requests.
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
});
