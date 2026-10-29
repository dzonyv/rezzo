/** Bundles the IPC lab into ipc/dist: main, preload and worker for Node, the page for the browser. */
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = import.meta.dirname;
const dist = path.join(here, 'dist');
await mkdir(dist, { recursive: true });

const common = { outdir: dist, bundle: true, sourcemap: 'inline', logLevel: 'warning' } as const;

await build({
  ...common,
  entryPoints: {
    main: path.join(here, 'main.ts'),
    preload: path.join(here, 'preload.ts'),
    worker: path.join(here, 'worker.ts'),
  },
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  // shared/paths.ts locates the repo through import.meta.url, which a CJS
  // bundle doesn't have; give it the real location of that file.
  define: {
    'import.meta.url': JSON.stringify(pathToFileURL(path.join(here, '..', 'shared', 'paths.ts')).href),
  },
});

await build({
  ...common,
  entryPoints: { renderer: path.join(here, 'renderer.ts'), relay: path.join(here, 'relay.ts') },
  platform: 'browser',
  format: 'iife',
  target: 'chrome140',
});

await copyFile(path.join(here, 'index.html'), path.join(dist, 'index.html'));
