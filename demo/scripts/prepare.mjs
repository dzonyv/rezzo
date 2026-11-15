// Fills demo/public/ with what the promo needs. Nothing in public/ is committed:
// the footage is cut from Tears of Steel, and the fonts, sounds and screenshots
// are copied from the app so there is only one copy of each in git.
//
// Usage: node scripts/prepare.mjs [path/to/tears_of_steel_720p.mov]
// Without a path, FFmpeg reads only the part it needs straight from Blender's server.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const demo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(demo, '..');
const pub = join(demo, 'public');
const FILM_URL = 'https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov';
/** The promo uses the film from 0:24 to 0:40: the talk on the bridge. */
export const FOOTAGE_START = 24;
const FOOTAGE_LENGTH = 16;

function findFfmpeg() {
  for (const dir of ['vendor/bin/ffmpeg', 'vendor/tools/ffmpeg']) {
    const root = join(repo, dir);
    if (!existsSync(root)) continue;
    for (const build of readdirSync(root)) {
      const exe = join(root, build, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
      if (existsSync(exe)) return exe;
    }
  }
  return 'ffmpeg';
}

mkdirSync(join(pub, 'fonts'), { recursive: true });
mkdirSync(join(pub, 'sounds'), { recursive: true });

const copies = {
  'icon.svg': 'resources/icon.svg',
  'episode.png': 'docs/screenshots/episode.png',
  'clip.png': 'docs/screenshots/clip.png',
  'fonts/Unbounded.ttf': 'src/renderer/src/ui/fonts/unbounded/Unbounded[wght].ttf',
  'fonts/Onest.ttf': 'src/renderer/src/ui/fonts/onest/Onest[wght].ttf',
  'fonts/Montserrat.ttf': 'src/renderer/src/fonts/montserrat/Montserrat[wght].ttf',
};
for (const sound of ['whoosh', 'swish', 'pop', 'mouse-click', 'ding']) {
  copies[`sounds/${sound}.ogg`] = `resources/sounds/${sound}.ogg`;
}
for (const [to, from] of Object.entries(copies)) copyFileSync(join(repo, from), join(pub, to));
console.log(`Copied ${Object.keys(copies).length} files from the app.`);

const footage = join(pub, 'footage.mp4');
if (existsSync(footage)) {
  console.log('public/footage.mp4 is already there; delete it to cut it again.');
} else {
  const source = process.argv[2] ?? FILM_URL;
  console.log(`Cutting the footage from ${source} ...`);
  // No sound: the film's soundtrack is CC BY-ND, and putting it under new pictures counts as adapting it.
  execFileSync(
    findFfmpeg(),
    [
      '-v', 'error', '-ss', String(FOOTAGE_START), '-i', source, '-t', String(FOOTAGE_LENGTH),
      '-an', '-vf', 'fps=30', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow',
      '-g', '15', '-bf', '0', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', footage,
    ],
    { stdio: 'inherit' },
  );
  console.log('Wrote public/footage.mp4');
}
