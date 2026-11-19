import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { base, site } from './site.config.mjs';

// Published to GitHub Pages as a project site; site.config.mjs says where.
export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  build: { format: 'directory' },
  vite: {
    // The screenshots, package.json and the changelog live outside site/.
    server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  },
});
