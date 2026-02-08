import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Build content script as a single self-contained bundle (no imports).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        contentScript: resolve(__dirname, 'src/contentScript.tsx')
      },
      output: {
        entryFileNames: 'contentScript.js',
        assetFileNames: 'assets/[name][extname]',
        inlineDynamicImports: true,
        manualChunks: undefined
      }
    }
  }
});
