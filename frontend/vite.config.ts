import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: false,

    // Target modern browsers — smaller, faster output
    target: 'es2020',

    // esbuild is faster than terser; output is equivalent for prod
    minify: 'esbuild',

    // Split large vendor libs into separate chunks:
    // browser caches react/tanstack between deploys (they change rarely)
    rollupOptions: {
      output: {
        manualChunks: {
          'react-core':  ['react', 'react-dom'],
          'react-router': ['react-router-dom'],
          'tanstack':    ['@tanstack/react-query'],
          'forms':       ['react-hook-form'],
        },
        // Hash-based filenames so CDN caches are busted only when content changes
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },

    // Raise warning threshold (tanstack + react ~400KB gzipped is normal)
    chunkSizeWarningLimit: 600,

    // CSS code-splitting — each chunk only loads its CSS
    cssCodeSplit: true,

    // Pre-inline small assets (saves round trips)
    assetsInlineLimit: 4096,
  },

  // Production: strip console.log / debugger statements
  esbuild: {
    drop: ['debugger'],
    // Keep console.error/warn for prod monitoring; drop only .log
    pure: ['console.log', 'console.debug', 'console.info'],
  },
});
