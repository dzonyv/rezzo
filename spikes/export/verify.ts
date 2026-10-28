/**
 * Checks the files produced by the export lab.
 *
 *   node export/verify.ts [run-name ...]
 *
 * For each run it decodes out.mp4 and reports:
 *   - frames: every output frame i must show source frame START_FRAME + i
 *     (top strip) and renderer frame i (bottom strip); no drops or duplicates
 *   - picture: PSNR of sample frames against the renderer's own RGBA pixels
 *     (what the preview shows), plus the mean colour shift on the colour bars
 *   - sync: time from each flash frame to the matching beep in the audio
 *   - stream: codec, colour tags, durations
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mediaDir } from '../shared/paths.ts';
import { ffmpegExe, ffprobeExe, run } from '../shared/tools.ts';
import { FG_RECT, FG_SCALE, FPS, FRAME_COUNT, OUT_H, OUT_W, PROBE, readBits, SAMPLE_FRAMES, START_FRAME } from './layout.ts';

const runsDir = path.join(mediaDir, 'export', 'runs');
const wanted = process.argv.slice(2);
const FRAME_BYTES = OUT_W * OUT_H * 3;

/** Output rows covered by the colour bars (source rows 300..700, with a margin). */
const BARS_ROWS = [Math.ceil(FG_RECT.y + 310 * FG_SCALE), Math.floor(FG_RECT.y + 690 * FG_SCALE)];

async function probe(file: string) {
  const { stdout } = await run(ffprobeExe(), [
    '-v', 'error', '-count_packets', '-show_entries',
    'stream=codec_type,codec_name,profile,pix_fmt,width,height,r_frame_rate,color_space,color_transfer,color_primaries,color_range,nb_read_packets,duration,start_time',
    '-of', 'json', file,
  ]);
  return JSON.parse(stdout).streams as Record<string, string | number>[];
}

/** Streams decoded RGB frames (BT.709 limited -> full range) to `onFrame`. */
function decodeFrames(file: string, onFrame: (rgb: Buffer, index: number) => void): Promise<number> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegExe(), [
      '-v', 'error', '-i', file, '-map', '0:v',
      '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int,format=rgb24',
      '-f', 'rawvideo', 'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'inherit'] });
    const frame = Buffer.alloc(FRAME_BYTES);
    let filled = 0;
    let index = 0;
    ff.stdout.on('data', (chunk: Buffer) => {
      let offset = 0;
      while (offset < chunk.length) {
        const n = Math.min(FRAME_BYTES - filled, chunk.length - offset);
        chunk.copy(frame, filled, offset, offset + n);
        filled += n;
        offset += n;
        if (filled === FRAME_BYTES) {
          onFrame(frame, index++);
          filled = 0;
        }
      }
    });
    ff.on('error', reject);
    ff.on('exit', (code) => (code === 0 ? resolve(index) : reject(new Error(`ffmpeg exited with ${code}`))));
  });
}

async function decodeAudio(file: string): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegExe(), ['-v', 'error', '-i', file, '-map', '0:a', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks: Buffer[] = [];
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.on('error', reject);
    ff.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with ${code}`));
      const all = Buffer.concat(chunks);
      resolve(new Int16Array(all.buffer, all.byteOffset, all.length / 2));
    });
  });
}

const luma = (rgb: Uint8Array, x: number, y: number, stride = 3) => {
  const i = (y * OUT_W + x) * stride;
  return 0.2126 * rgb[i] + 0.7152 * rgb[i + 1] + 0.0722 * rgb[i + 2];
};

function comparePicture(out: Buffer, ref: Uint8Array) {
  let se = 0;
  const shift = [0, 0, 0];
  let barPixels = 0;
  for (let y = 0; y < OUT_H; y++) {
    const inBars = y >= BARS_ROWS[0] && y <= BARS_ROWS[1];
    for (let x = 0; x < OUT_W; x++) {
      const o = (y * OUT_W + x) * 3;
      const r = (y * OUT_W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const d = out[o + c] - ref[r + c];
        se += d * d;
        if (inBars) shift[c] += d;
      }
      if (inBars) barPixels++;
    }
  }
  const mse = se / (OUT_W * OUT_H * 3);
  return {
    psnr: mse === 0 ? Infinity : +(10 * Math.log10((255 * 255) / mse)).toFixed(2),
    barShiftRGB: shift.map((s) => +(s / barPixels).toFixed(2)),
  };
}

function beepOnsets(samples: Int16Array): number[] {
  const onsets: number[] = [];
  let lastLoud = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > 3000) {
      if (i - lastLoud > 0.3 * 48000) onsets.push(i / 48000);
      lastLoud = i;
    }
  }
  return onsets;
}

async function verify(name: string) {
  const dir = path.join(runsDir, name);
  const file = path.join(dir, 'out.mp4');
  const streams = await probe(file);

  const refs = new Map<number, Uint8Array>();
  for (const i of SAMPLE_FRAMES) refs.set(i, await readFile(path.join(dir, `ref-${i}.rgba`)));

  let outMismatch = 0;
  let srcMismatch = 0;
  let duplicates = 0;
  let jumps = 0;
  let previousSrc = -1;
  const firstProblems: string[] = [];
  const flashTimes: number[] = [];
  const pictures: Record<number, ReturnType<typeof comparePicture>> = {};

  const frames = await decodeFrames(file, (rgb, i) => {
    const src = readBits((b) => luma(rgb, PROBE.bitX(b), PROBE.srcBitsRow));
    const out = readBits((b) => luma(rgb, PROBE.bitX(b), PROBE.outBitsRow));
    if (out !== i) outMismatch++;
    if (src !== START_FRAME + i) {
      srcMismatch++;
      if (firstProblems.length < 5) firstProblems.push(`frame ${i}: source ${src}, expected ${START_FRAME + i}`);
    }
    if (src === previousSrc) duplicates++;
    else if (previousSrc >= 0 && src !== previousSrc + 1) jumps++;
    previousSrc = src;
    if (luma(rgb, PROBE.flash.x, PROBE.flash.y) > 128) flashTimes.push(i / FPS);
    const ref = refs.get(i);
    if (ref) pictures[i] = comparePicture(rgb, ref);
  });

  const onsets = beepOnsets(await decodeAudio(file));
  const offsetsMs = flashTimes.map((t) => {
    const nearest = onsets.reduce((best, o) => (Math.abs(o - t) < Math.abs(best - t) ? o : best), Infinity);
    return (nearest - t) * 1000;
  }).filter(Number.isFinite);

  const v = streams.find((s) => s.codec_type === 'video')!;
  const a = streams.find((s) => s.codec_type === 'audio');
  const psnrs = Object.values(pictures).map((p) => p.psnr);

  return {
    name,
    frames: { decoded: frames, expected: FRAME_COUNT, outMismatch, srcMismatch, duplicates, jumps, firstProblems },
    picture: { minPsnr: Math.min(...psnrs), samples: pictures },
    sync: {
      flashes: flashTimes.length,
      beeps: onsets.length,
      offsetMs: offsetsMs.length
        ? { mean: +(offsetsMs.reduce((s, x) => s + x, 0) / offsetsMs.length).toFixed(2), min: +Math.min(...offsetsMs).toFixed(2), max: +Math.max(...offsetsMs).toFixed(2) }
        : null,
    },
    stream: {
      video: `${v.codec_name} ${v.profile} ${v.pix_fmt} ${v.width}x${v.height} ${v.r_frame_rate}`,
      colour: `${v.color_space ?? '?'}/${v.color_primaries ?? '?'}/${v.color_transfer ?? '?'}/${v.color_range ?? '?'}`,
      videoSeconds: Number(v.duration),
      audioSeconds: a ? Number(a.duration) : null,
      audioStart: a ? Number(a.start_time) : null,
    },
  };
}

const names = (await readdir(runsDir)).filter((n) => wanted.length === 0 || wanted.includes(n));
const results = [];
for (const name of names) {
  try {
    const r = await verify(name);
    results.push(r);
    console.log(JSON.stringify(r));
  } catch (e) {
    console.error(`${name}: ${e}`);
  }
}

await writeFile(path.join(mediaDir, 'export', 'verify.json'), JSON.stringify(results, null, 2));

console.log('\n| Run | Frames OK | Drops/dups | Min PSNR | Colour shift on bars (R,G,B) | A/V offset ms (mean, max) | Colour tags |');
console.log('|---|---|---|---|---|---|---|');
for (const r of results) {
  const okFrames = r.frames.decoded - Math.max(r.frames.srcMismatch, r.frames.outMismatch);
  const worst = Object.values(r.picture.samples).reduce((w, p) => (p.psnr < w.psnr ? p : w));
  const sync = r.sync.offsetMs ? `${r.sync.offsetMs.mean}, ${Math.max(Math.abs(r.sync.offsetMs.min), Math.abs(r.sync.offsetMs.max))}` : 'n/a';
  console.log(`| ${r.name} | ${okFrames}/${r.frames.expected} | ${r.frames.jumps}/${r.frames.duplicates} | ${r.picture.minPsnr} dB | ${worst.barShiftRGB.join(', ')} | ${sync} | ${r.stream.colour} |`);
}
