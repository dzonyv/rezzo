/** Bundles the face lab into faces/lab/dist with esbuild. */
import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const here = import.meta.dirname;
const dist = path.join(here, 'dist');
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    main: path.join(here, '..', '..', 'shared', 'lab-main.ts'),
    renderer: path.join(here, 'renderer.ts'),
  },
  outdir: dist,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: 'inline',
  logLevel: 'warning',
  define: {
    'import.meta.url': JSON.stringify(pathToFileURL(path.join(here, '..', '..', 'shared', 'paths.ts')).href),
  },
});

await copyFile(path.join(here, 'index.html'), path.join(dist, 'index.html'));
