/**
 * How much a "stacked" H.264 working file loses: colour in the top half,
 * alpha as luma in the bottom half, so a video layer with transparency goes
 * through the same WebCodecs path as every other working file.
 *
 * Variants:
 * - straight: the colour half is the file's colour as is;
 *   premult: colour × alpha, so transparent areas are black.
 * - unpadded: each half is 1080 rows, so the seam sits inside a 16-row
 *   macroblock; padded: each half is rounded up to 1088 rows.
 *
 * Each variant is decoded back with FFmpeg and compared with the reference:
 * alpha, colour × alpha, the composite over a checkerboard, and what leaks
 * across the seam. Also writes the overlay files the decoding lab uses.
 *
 *   node layers/stacked.ts
 */
import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ffmpegExe, run } from '../shared/tools.ts';
import {
  align16, backgroundAt, layersDir, makeReference, psnr, readRgba, REF_H, REF_SECONDS, REF_W, referenceFile,
  round, sampleSelect, stackedFilter, stackedHalf,
} from './common.ts';

const stackedDir = path.join(layersDir, 'stacked');
const SEAM_ROWS = 8;

const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16'];
const NVENC = ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '18', '-b:v', '0'];

function encodeArgs(input: string, filter: string, out: string, extra: string[] = [], encoder = X264): string[] {
  return [
    '-y', '-v', 'error', ...extra, '-i', input, '-filter_complex', filter, '-map', '[v]',
    ...encoder, '-g', '15', '-keyint_min', '15', '-bf', '0',
    ...COLOR_TAGS, '-movflags', '+faststart', out,
  ];
}

interface Variant {
  id: string;
  /** Colour under transparent pixels: carries on smoothly, or black as many exports have it. */
  blackUnder: boolean;
  premultiply: boolean;
  padded: boolean;
  nvenc?: boolean;
  planar?: boolean;
}

const variants: Variant[] = [
  { id: 'straight-unpadded', blackUnder: false, premultiply: false, padded: false },
  { id: 'straight-padded', blackUnder: false, premultiply: false, padded: true },
  { id: 'straight-padded-nvenc', blackUnder: false, premultiply: false, padded: true, nvenc: true },
  { id: 'planar-padded', blackUnder: false, premultiply: false, padded: true, planar: true },
  { id: 'planar-padded-nvenc', blackUnder: false, premultiply: false, padded: true, planar: true, nvenc: true },
  { id: 'premult-padded', blackUnder: false, premultiply: true, padded: true },
  { id: 'black-under-straight-padded', blackUnder: true, premultiply: false, padded: true },
];

function measure(ref: Buffer[], got: Buffer[], half: number, premultiplied: boolean) {
  const W = REF_W;
  const H = REF_H;
  let aSq = 0;
  let pSq = 0;
  let compSq = 0;
  let edgeSq = 0;
  let edgeN = 0;
  // Leaks across the seam: alpha in the alpha half's top rows (the
  // reference has none there) and composite error in the colour half's bottom rows.
  let leakMax = 0;
  let leakSum = 0;
  let seamCompSq = 0;
  let restCompSq = 0;
  const n = Math.min(ref.length, got.length);
  for (let f = 0; f < n; f++) {
    const r = ref[f];
    const g = got[f];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const j = ((half + y) * W + x) * 4;
        const ra = r[i + 3];
        // Luma, as the shader will read it: chroma the encoder left in the alpha half cancels out.
        const ga = Math.min(255, Math.round(0.2126 * g[j] + 0.7152 * g[j + 1] + 0.0722 * g[j + 2]));
        aSq += (ra - ga) ** 2;
        const bg = backgroundAt(x, y);
        let comp = 0;
        for (let c = 0; c < 3; c++) {
          const rp = (r[i + c] * ra) / 255;
          const gp = premultiplied ? g[i + c] : (g[i + c] * ga) / 255;
          pSq += (rp - gp) ** 2;
          const d = (rp + (bg * (255 - ra)) / 255 - (gp + (bg * (255 - ga)) / 255)) ** 2;
          comp += d;
        }
        compSq += comp;
        if (ra > 0 && ra < 255) {
          edgeSq += comp;
          edgeN += 3;
        }
        if (y >= H - SEAM_ROWS) seamCompSq += comp;
        else restCompSq += comp;
        if (y < SEAM_ROWS && ra === 0) {
          leakMax = Math.max(leakMax, ga);
          leakSum += ga;
        }
      }
    }
  }
  const px = n * W * H;
  return {
    alphaPsnr: round(psnr(aSq, px)),
    premultPsnr: round(psnr(pSq, px * 3)),
    compositePsnr: round(psnr(compSq, px * 3)),
    compositeEdgePsnr: round(psnr(edgeSq, edgeN)),
    compositeSeamRowsPsnr: round(psnr(seamCompSq, n * W * SEAM_ROWS * 3)),
    compositeOtherRowsPsnr: round(psnr(restCompSq, n * W * (H - SEAM_ROWS) * 3)),
    seamAlphaLeakMax: leakMax,
    seamAlphaLeakMean: round(leakSum / (n * W * SEAM_ROWS), 3),
  };
}

await mkdir(stackedDir, { recursive: true });
if (!existsSync(referenceFile)) await makeReference();
const ref = await readRgba(referenceFile, REF_W, REF_H, { filter: sampleSelect });

const results = [];
for (const v of variants) {
  const half = v.padded ? align16(REF_H) : REF_H;
  const out = path.join(stackedDir, `${v.id}.mp4`);
  const t0 = performance.now();
  await run(ffmpegExe(), encodeArgs(referenceFile, stackedFilter({ premultiply: v.premultiply, blackUnder: v.blackUnder, planar: v.planar, halfHeight: v.padded ? half : undefined }), out, [], v.nvenc ? NVENC : X264));
  const encodeSeconds = (performance.now() - t0) / 1000;
  const got = await readRgba(out, REF_W, half * 2, { filter: sampleSelect });
  const row = {
    id: v.id,
    size: `${REF_W}x${half * 2}`,
    mbPerMinute: round(((await stat(out)).size / 1e6 / REF_SECONDS) * 60, 1),
    encodeRealtime: round(REF_SECONDS / encodeSeconds, 1),
    ...measure(ref, got, half, v.premultiply),
  };
  results.push(row);
  console.log(JSON.stringify(row));
}
await writeFile(path.join(layersDir, 'stacked.json'), JSON.stringify(results, null, 2));

console.log('\n| Variant | Size | MB/min | Encode (× realtime) | Alpha PSNR | Colour×alpha | Composite | Composite, edges | Seam rows / other rows | Alpha leak at seam (max / mean) |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  console.log(
    `| ${r.id} | ${r.size} | ${r.mbPerMinute} | ${r.encodeRealtime} | ${r.alphaPsnr} | ${r.premultPsnr} | ${r.compositePsnr} | ` +
      `${r.compositeEdgePsnr} | ${r.compositeSeamRowsPsnr} / ${r.compositeOtherRowsPsnr} | ${r.seamAlphaLeakMax} / ${r.seamAlphaLeakMean} |`,
  );
}

// Overlay files for the decoding lab: 12 s, looped from the reference,
// straight and padded: 1920 wide (the plan's limit), 1280 wide, and a
// full-screen vertical one (stretched, only its size matters here).
const labFiles = [['overlay-1080', 1920, 1080], ['overlay-720', 1280, 720], ['overlay-vertical', 1080, 1920]] as const;
for (const [name, w, h] of labFiles) {
  const out = path.join(layersDir, `${name}.mp4`);
  if (existsSync(out)) continue;
  const filter = stackedFilter({ premultiply: false, planar: true, halfHeight: stackedHalf(h) }).replace('[0:v]', `[0:v]scale=${w}:${h},`);
  await run(ffmpegExe(), encodeArgs(referenceFile, filter, out, ['-stream_loop', '2']));
  console.log('wrote', out);
}
