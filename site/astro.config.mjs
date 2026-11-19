import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

// Published to GitHub Pages as a project site: https://dzonyv.github.io/rezzo/.
// With a domain of its own later, `site` becomes that domain and `base` goes.
export default defineConfig({
  site: 'https://dzonyv.github.io',
  base: '/rezzo',
  trailingSlash: 'always',
  build: { format: 'directory' },
  vite: {
    // The screenshots, package.json and the changelog live outside site/.
    server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  },
});
