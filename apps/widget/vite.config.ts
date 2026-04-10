import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@open333crm/shared': resolve(__dirname, '../../packages/shared/dist/index.js'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Open333CRMWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    outDir: 'dist',
    rollupOptions: {
      // Bundle socket.io-client into the IIFE — no external deps for embed script
      external: [],
    },
  },
});
