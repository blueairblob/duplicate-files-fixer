import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import security from './src/main/security.js';

// Production builds get a strict Content-Security-Policy (see security.js).
// The dev server is left without one: hot reload needs inline scripts.
const cspPlugin = {
  name: 'holdfast-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${security.CSP}" />`);
  },
};

export default defineConfig({
  plugins: [react(), cspPlugin],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.js'],
  },
});
