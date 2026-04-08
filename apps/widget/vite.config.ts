import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
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
