import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';

// Entry points are electron-vite's defaults: src/main/index.ts,
// src/preload/index.ts and src/renderer/index.html. Utility processes are
// imported with `?modulePath` from the main process, which bundles each one
// as its own entry.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
  },
});
