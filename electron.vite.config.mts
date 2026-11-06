import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { build, type Plugin, type Rollup } from 'vite';

/**
 * MediaPipe needs a classic worker, and the dev server can't serve one: it
 * leaves the worker's imports in, which a classic script can't have. So in
 * development a classic worker is bundled here, as the build bundles it.
 */
function classicWorkersInDev(): Plugin {
  return {
    name: 'rezzo:classic-workers-in-dev',
    apply: 'serve',
    enforce: 'pre',
    async load(id) {
      const [file, query] = id.split('?');
      if (!file || !query?.includes('worker_file') || !query.includes('type=classic')) return null;
      const result = await build({
        configFile: false,
        logLevel: 'warn',
        mode: 'development',
        build: { write: false, minify: false, lib: { entry: file, formats: ['iife'], name: 'worker' } },
      });
      const [chunk] = ((Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput).output;
      // A change to anything the worker uses bundles it again.
      for (const module of chunk.moduleIds) this.addWatchFile(module);
      return chunk.code;
    },
  };
}

// Entry points are electron-vite's defaults: src/main/index.ts,
// src/preload/index.ts and src/renderer/index.html. Utility processes are
// imported with `?modulePath` from the main process, which bundles each one
// as its own entry.
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react(), classicWorkersInDev()],
  },
});
