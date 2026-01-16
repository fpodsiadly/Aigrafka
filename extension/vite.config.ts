import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        contentScript: resolve(__dirname, 'src/contentScript.tsx'),
        background: resolve(__dirname, 'src/background/serviceWorker.ts'),
        panelPreview: resolve(__dirname, 'src/panel/preview.html')
      },
      output: {
        entryFileNames: chunk => `${chunk.name}.js`,
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]'
      }
    }
  }
});
