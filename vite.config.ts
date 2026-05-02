import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import packageJson from './package.json';

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          monaco: ['monaco-editor', '@monaco-editor/react'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});
