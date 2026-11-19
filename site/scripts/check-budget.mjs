// Checks the built site against its weight budget and fails if a page is
// over. Run after `npm run build`:
//
//   npm run budget
//
// Sizes are what goes over the network: HTML, CSS and JS gzipped, fonts and
// images as they are (they're compressed already). For a responsive image it
// counts the largest candidate, the worst case.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const KB = 1024;
const limits = {
  html: 20 * KB,
  css: 12 * KB,
  js: 5 * KB,
  fonts: 70 * KB,
  eagerImage: 90 * KB,
  lazyImage: 120 * KB,
  firstScreen: 300 * KB,
  page: 700 * KB,
  firstScreenRequests: 12,
};
const base = '/rezzo/';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

const pages = walk(dist).filter((f) => f.endsWith('.html'));
if (pages.length === 0) {
  console.error('No pages in dist/. Run `npm run build` first.');
  process.exit(1);
}

let failed = false;
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const problems = [];
  const sizes = {};

  sizes.html = gzipSync(html).length;

  const stylesheets = attrs(html, /<link[^>]+rel="stylesheet"[^>]*>/g, 'href');
  const inlineCss = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('');
  sizes.css = stylesheets.reduce((sum, href) => sum + gzipSync(readFileSync(file(href))).length, 0) + (inlineCss ? gzipSync(inlineCss).length : 0);

  const scripts = attrs(html, /<script[^>]+src="[^"]*"[^>]*>/g, 'src');
  const inlineJs = [...html.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('');
  sizes.js = scripts.reduce((sum, src) => sum + gzipSync(readFileSync(file(src))).length, 0) + (inlineJs.trim() ? gzipSync(inlineJs).length : 0);

  const fonts = attrs(html, /<link[^>]+rel="preload"[^>]+as="font"[^>]*>/g, 'href');
  sizes.fonts = fonts.reduce((sum, href) => sum + size(href), 0);

  const images = findImages(html);
  let eagerImages = 0;
  let allImages = 0;
  for (const image of images) {
    const bytes = size(image.url);
    allImages += bytes;
    if (image.eager) eagerImages += bytes;
    const limit = image.eager ? limits.eagerImage : limits.lazyImage;
    if (bytes > limit) problems.push(`image ${image.url} is ${kb(bytes)}, over ${kb(limit)}`);
  }

  sizes.firstScreen = sizes.html + sizes.css + sizes.js + sizes.fonts + eagerImages;
  sizes.page = sizes.firstScreen + allImages - eagerImages;
  const requests = 1 + stylesheets.length + scripts.length + fonts.length + images.filter((i) => i.eager).length;

  for (const key of ['html', 'css', 'js', 'fonts', 'firstScreen', 'page']) {
    if (sizes[key] > limits[key]) problems.push(`${key} is ${kb(sizes[key])}, over ${kb(limits[key])}`);
  }
  if (requests > limits.firstScreenRequests) {
    problems.push(`${requests} requests on the first screen, over ${limits.firstScreenRequests}`);
  }

  const name = '/' + relative(dist, page).replaceAll('\\', '/');
  console.log(
    `${problems.length ? '✗' : '✓'} ${name}  first screen ${kb(sizes.firstScreen)} in ${requests} requests, whole page ${kb(sizes.page)} (html ${kb(sizes.html)}, css ${kb(sizes.css)}, js ${kb(sizes.js)}, fonts ${kb(sizes.fonts)})`,
  );
  for (const p of problems) console.log(`    ${p}`);
  if (problems.length) failed = true;
}

if (failed) {
  console.error('\nOver budget. The limits are at the top of scripts/check-budget.mjs.');
  process.exit(1);
}

/** Each picture or img on the page: the largest file it may load, and whether it loads right away. */
function findImages(html) {
  const found = [];
  const withoutPictures = html.replace(/<picture[\s\S]*?<\/picture>/g, (picture) => {
    const source = picture.match(/<source[^>]*srcset="([^"]+)"/);
    const img = picture.match(/<img[^>]*>/)[0];
    found.push({ url: largest(source ? source[1] : attr(img, 'srcset') ?? attr(img, 'src')), eager: attr(img, 'loading') !== 'lazy' });
    return '';
  });
  for (const [img] of withoutPictures.matchAll(/<img[^>]*>/g)) {
    const src = attr(img, 'srcset') ?? attr(img, 'src');
    if (src && !src.startsWith('data:')) found.push({ url: largest(src), eager: attr(img, 'loading') !== 'lazy' });
  }
  return found;
}

function largest(srcset) {
  return srcset
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/))
    .map(([url, descriptor = '1x']) => ({ url, w: parseFloat(descriptor) }))
    .sort((a, b) => b.w - a.w)[0].url;
}

function attrs(html, tagPattern, name) {
  return [...html.matchAll(tagPattern)].map((m) => attr(m[0], name)).filter(Boolean);
}

function attr(tag, name) {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

function file(url) {
  const path = decodeURIComponent(url.split(/[?#]/)[0]);
  if (!path.startsWith(base)) throw new Error(`${url} isn't under ${base}`);
  return join(dist, path.slice(base.length));
}

function size(url) {
  return statSync(file(url)).size;
}

function kb(bytes) {
  return `${(bytes / KB).toFixed(1)} KB`;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}
