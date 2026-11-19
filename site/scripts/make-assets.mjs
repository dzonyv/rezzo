// Makes the site's fonts, icons and the vertical clip picture from files
// already in the repo. Run it again when one of those changes:
//
//   npm run make-assets
//
// The results are committed, so the site build doesn't need this.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import subsetFont from 'subset-font';

const repo = new URL('../../', import.meta.url);
const site = new URL('../', import.meta.url);
const uiFonts = new URL('src/renderer/src/ui/fonts/', repo);

// Every character the site's text can use: ASCII, Latin-1 (for ×, ·, «»
// and the like), the letters of Serbian Latin, and typographic punctuation.
// Headings and the monospaced labels get less: no Latin-1 letters.
const short = [range(0x20, 0x7e), 'ČčĆćĐđŠšŽž', '×·–—‘’‚“”„…→'].join('');
const full = [short, range(0xa0, 0xff), '•≤≥−'].join('');

const fonts = [
  // [source, output, characters, weight range or null for a static font]
  ['onest/Onest[wght].ttf', 'onest.woff2', full, { min: 400, max: 700 }],
  // Pinned to one weight: headings are all ExtraBold, and it halves the file.
  ['unbounded/Unbounded[wght].ttf', 'unbounded.woff2', short, { min: 800, max: 800 }],
  ['dm-mono/DMMono-Regular.ttf', 'dm-mono.woff2', short, null],
];

await mkdir(new URL('public/fonts/', site), { recursive: true });
for (const [source, output, text, wght] of fonts) {
  const input = await readFile(new URL(source, uiFonts));
  const options = { targetFormat: 'woff2' };
  if (wght) options.variationAxes = { wght };
  const woff2 = await subsetFont(input, text, options);
  await writeFile(new URL(`public/fonts/${output}`, site), woff2);
  console.log(`${output}: ${(woff2.length / 1024).toFixed(1)} KB`);
}
for (const folder of ['onest', 'unbounded', 'dm-mono']) {
  await copyFile(new URL(`${folder}/OFL.txt`, uiFonts), new URL(`public/fonts/${folder}-OFL.txt`, site));
}

// The app icon, as it is for browsers that take SVG, and as a PNG for phones.
await copyFile(new URL('resources/icon.svg', repo), new URL('public/favicon.svg', site));
await sharp(fileURLToPath(new URL('resources/icon.png', repo)))
  .resize(180, 180)
  .png()
  .toFile(fileURLToPath(new URL('public/apple-touch-icon.png', site)));

// The 9:16 preview cut out of the clip editor screenshot. A frame from a
// real exported clip would be sharper; this stands in until there is one.
await mkdir(new URL('src/assets/', site), { recursive: true });
await sharp(fileURLToPath(new URL('docs/screenshots/clip.png', repo)))
  .extract({ left: 770, top: 99, width: 186, height: 331 })
  .png()
  .toFile(fileURLToPath(new URL('src/assets/clip-vertical.png', site)));

function range(from, to) {
  let s = '';
  for (let c = from; c <= to; c++) s += String.fromCharCode(c);
  return s;
}
