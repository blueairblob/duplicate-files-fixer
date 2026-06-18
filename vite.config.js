import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.js'],
  },
});
