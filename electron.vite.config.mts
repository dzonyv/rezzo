import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { build, normalizePath, type Plugin, type ResolvedConfig, type Rollup } from 'vite';

/**
 * MediaPipe needs a classic worker, and the dev server can't serve one: it
 * leaves the worker's imports in, which a classic script can't have. So in
 * development a classic worker is bundled here, as the build bundles it:
 * with the renderer's aliases and defines, and without its plugins.
 *
 * An edit to anything a worker uses bundles it again the next time it's
 * asked for. The page keeps the worker it has until it reloads.
 */
function classicWorkersInDev(): Plugin {
  let config: ResolvedConfig;
  /** The files in each bundled worker, by the worker's module id. */
  const bundled = new Map<string, Set<string>>();
  return {
    name: 'rezzo:classic-workers-in-dev',
    apply: 'serve',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved;
    },
    configureServer(server) {
      server.watcher.on('change', (changed) => {
        for (const [id, files] of bundled) {
          const module = files.has(normalizePath(changed)) && server.moduleGraph.getModuleById(id);
          if (module) server.moduleGraph.invalidateModule(module);
        }
      });
    },
    async load(id) {
      const [file, query] = id.split('?');
      if (!file || !query?.includes('worker_file') || !query.includes('type=classic')) return null;
      const result = await build({
        configFile: false,
        logLevel: 'warn',
        mode: 'development',
        resolve: { alias: config.resolve.alias },
        define: config.define,
        build: { write: false, minify: false, lib: { entry: file, formats: ['iife'], name: 'worker' } },
      });
      const [chunk] = ((Array.isArray(result) ? result[0] : result) as Rollup.RollupOutput).output;
      // Some of these are outside the renderer's root, which is all the dev server watches.
      for (const module of chunk.moduleIds) this.addWatchFile(module);
      bundled.set(id, new Set(chunk.moduleIds.map(normalizePath)));
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
