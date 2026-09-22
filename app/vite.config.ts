import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the built app works from any static host,
  // including a GitHub Pages project subpath, and from the local filesystem.
  base: './',
  build: {
    // pdf.js and recharts are inherently large; the app is still a single
    // static download with no runtime cost, so raise the warning threshold.
    chunkSizeWarningLimit: 1600,
  },
});
