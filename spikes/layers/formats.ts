/**
 * Which overlay formats keep their alpha through our bundled FFmpeg, and
 * how ffprobe tells us a file has alpha at all.
 *
 * Encodes the synthetic RGBA reference into every format a user is likely
 * to bring, then decodes each one back (with the default decoder and, for
 * VP8/VP9, with libvpx) and compares alpha and colour with the reference.
 *
 *   node layers/formats.ts
 */
import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ffmpegExe, run } from '../shared/tools.ts';
import {
  layersDir, makeReference, probe, psnr, readRgba, REF_H, REF_W, referenceFile, round, sampleSelect,
} from './common.ts';

interface Candidate {
  id: string;
  file: string;
  encode: string[];
  /** Decoders to try besides FFmpeg's default. */
  decoders?: string[];
}

const formatsDir = path.join(layersDir, 'formats');

const candidates: Candidate[] = [
  { id: 'webm-vp9', file: 'vp9.webm', encode: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-crf', '24', '-b:v', '0', '-row-mt', '1', '-cpu-used', '4'], decoders: ['libvpx-vp9'] },
  { id: 'webm-vp8', file: 'vp8.webm', encode: ['-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-crf', '10', '-b:v', '8M', '-auto-alt-ref', '0'], decoders: ['libvpx'] },
  { id: 'prores-4444', file: 'prores4444.mov', encode: ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16'] },
  { id: 'qtrle-mov', file: 'qtrle.mov', encode: ['-c:v', 'qtrle', '-pix_fmt', 'argb'] },
  { id: 'png-mov', file: 'png.mov', encode: ['-c:v', 'png', '-pix_fmt', 'rgba'] },
  { id: 'hevc-alpha', file: 'hevc-alpha.mp4', encode: ['-c:v', 'libx265', '-pix_fmt', 'yuva420p', '-crf', '20', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'] },
  {
    id: 'gif', file: 'anim.gif',
    encode: ['-filter_complex', '[0:v]split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128'],
  },
  { id: 'apng', file: 'anim.apng', encode: ['-c:v', 'apng', '-pix_fmt', 'rgba', '-plays', '0', '-f', 'apng'] },
  { id: 'webp-anim', file: 'anim.webp', encode: ['-c:v', 'libwebp_anim', '-pix_fmt', 'yuva420p', '-quality', '80', '-loop', '0'] },
  // No alpha at all: the control for alpha detection.
  { id: 'h264-mp4', file: 'h264.mp4', encode: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16'] },
];

interface Decoded {
  decoder: string;
  frames: number;
  alphaKept: boolean;
  alphaPsnr: number;
  /** Colour times alpha, so differences under fully transparent pixels don't count. */
  premultPsnr: number;
}

function compare(ref: Buffer[], got: Buffer[]): Omit<Decoded, 'decoder'> {
  const n = Math.min(ref.length, got.length);
  let aSq = 0;
  let cSq = 0;
  let alphaKept = false;
  for (let f = 0; f < n; f++) {
    const r = ref[f];
    const g = got[f];
    for (let i = 0; i < r.length; i += 4) {
      const ra = r[i + 3];
      const ga = g[i + 3];
      if (ga !== 255) alphaKept = true;
      aSq += (ra - ga) ** 2;
      for (let c = 0; c < 3; c++) cSq += ((r[i + c] * ra - g[i + c] * ga) / 255) ** 2;
    }
  }
  const px = n * REF_W * REF_H;
  return { frames: got.length, alphaKept, alphaPsnr: round(psnr(aSq, px)), premultPsnr: round(psnr(cSq, px * 3)) };
}

await mkdir(formatsDir, { recursive: true });
if (!existsSync(referenceFile)) {
  console.log('making the reference…');
  await makeReference();
}
const ref = await readRgba(referenceFile, REF_W, REF_H, { filter: sampleSelect });

const results = [];
for (const c of candidates) {
  const file = path.join(formatsDir, c.file);
  const row: Record<string, unknown> = { id: c.id, file: c.file };
  try {
    if (!existsSync(file)) await run(ffmpegExe(), ['-y', '-v', 'error', '-i', referenceFile, ...c.encode, file]);
  } catch (e) {
    row.encodeError = String(e).split('\n').slice(0, 3).join(' ');
    results.push(row);
    console.log(c.id, 'encode failed:', row.encodeError);
    continue;
  }
  row.mbPerSecond = round((await stat(file)).size / 1e6 / 4, 2);
  row.probe = await probe(file);
  const decoded: Decoded[] = [];
  for (const decoder of [undefined, ...(c.decoders ?? [])]) {
    try {
      const got = await readRgba(file, REF_W, REF_H, { decoder, filter: sampleSelect });
      decoded.push({ decoder: decoder ?? 'default', ...compare(ref, got) });
    } catch (e) {
      decoded.push({ decoder: decoder ?? 'default', error: String(e).split('\n').slice(0, 2).join(' ') } as never);
    }
  }
  row.decoded = decoded;
  results.push(row);
  console.log(JSON.stringify(row));
}

await writeFile(path.join(layersDir, 'formats.json'), JSON.stringify(results, null, 2));

console.log('\n| Format | Size (MB/s) | ffprobe pix_fmt | alpha_mode tag | Decoder | Alpha kept | Alpha PSNR | Colour×alpha PSNR |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of results as Record<string, any>[]) {
  if (r.encodeError) {
    console.log(`| ${r.id} | — | encode failed | | | | | |`);
    continue;
  }
  for (const d of r.decoded) {
    console.log(
      `| ${r.id} | ${r.mbPerSecond} | ${r.probe.pixFmt} | ${r.probe.alphaMode ?? ''} | ${d.decoder} | ` +
        (d.error ? `error | | |` : `${d.alphaKept ? 'yes' : 'no'} | ${d.alphaPsnr} dB | ${d.premultPsnr} dB |`),
    );
  }
}
