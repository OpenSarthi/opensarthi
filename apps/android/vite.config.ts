import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Allow Vite dev server to serve files from outside the android root
    // (needed for importing desktop CSS)
    fs: {
      allow: [
        path.resolve(__dirname, '.'),          // apps/android
        path.resolve(__dirname, '../desktop'), // apps/desktop (for CSS)
      ],
    },
  },
  resolve: {
    alias: {
      // Convenience alias — not used by current code, available for future
      '@desktop': path.resolve(__dirname, '../desktop/src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          framer: ['framer-motion'],
          zustand: ['zustand'],
        },
      },
    },
  },
});
