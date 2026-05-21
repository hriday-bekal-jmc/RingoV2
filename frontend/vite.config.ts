import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 8 + Rolldown bundler. Industry-standard config:
// - codeSplitting.groups (replaces Rollup manualChunks)
// - output.minify.compress.dropConsole/dropDebugger (replaces esbuild.drop/pure)
// - Lightning CSS minification by default (replaces esbuild for CSS)
export default defineConfig({
  plugins: [react()],

  server: {
    // host: true exposes dev server on LAN (0.0.0.0) so phones on the same
    // WiFi can hit http://<laptop-lan-ip>:5173. localhost-only by default
    // means phones can't reach the dev server.
    host: true,
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

    // Rolldown options (replaces rollupOptions in Vite 8)
    rolldownOptions: {
      output: {
        // Vendor chunk splitting via Rolldown's native codeSplitting.groups.
        // Browser caches react/tanstack between deploys (they rarely change).
        codeSplitting: {
          groups: [
            { name: 'react-core',   test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'react-router', test: /[\\/]node_modules[\\/]react-router(-dom)?[\\/]/ },
            { name: 'tanstack',     test: /[\\/]node_modules[\\/]@tanstack[\\/]/ },
            { name: 'forms',        test: /[\\/]node_modules[\\/]react-hook-form[\\/]/ },
          ],
        },
        // Strip console.* + debugger in production builds.
        // Rolldown's Rust-based minifier (replaces esbuild.drop/pure)
        minify: {
          compress: {
            dropConsole: true,    // strip all console.* calls
            dropDebugger: true,   // strip debugger statements
          },
          mangle: true,
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
});
