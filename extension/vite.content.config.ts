import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Build content script as a single self-contained bundle (no imports).
// Use Preact via compat aliases to reduce bundle size vs React.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
    }
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
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
