/**
 * Export lab: runs the 0c measurements inside Electron and writes the raw
 * numbers to <media>/export/results.json. The exported files are checked
 * afterwards by export/verify.ts.
 *
 *   preview  decode + render speed, and frames that miss their slot at 30 fps
 *   seek     random-access latency for each working-file variant
 *   export   the five export paths (see EXPORTS)
 */
import { ipcRenderer } from 'electron';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaDir } from '../../shared/paths.ts';
import { ffmpegExe } from '../../shared/tools.ts';
import { FPS, FRAME_COUNT, OUT_H, OUT_W, PROBE, readBits, SAMPLE_FRAMES, SRC_FRAMES, START_FRAME } from '../layout.ts';
import { demux, FrameSource, type Demuxed } from './decode.ts';
import { Compositor, RGBA_BYTES, YUV_BYTES } from './gl.ts';

const dir = path.join(mediaDir, 'export');
const WORKING = path.join(dir, 'work-g30.mp4');
const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

type ExportRun =
  | { name: string; kind: 'pipe'; format: 'rgba' | 'yuv'; encoder: 'nvenc' | 'x264' }
  | { name: string; kind: 'webcodecs'; accel: HardwareAcceleration };

/**
 * A: read pixels back from WebGL and pipe them to FFmpeg, which encodes.
 *    "rgba" lets FFmpeg convert colours; "yuv" converts on the GPU first,
 *    which also cuts the data to read back from 8.3 MB to 3.1 MB per frame.
 * B: let Chromium encode the canvas with WebCodecs; FFmpeg only muxes.
 */
const EXPORTS: ExportRun[] = [
  { name: 'A-rgba-nvenc', kind: 'pipe', format: 'rgba', encoder: 'nvenc' },
  { name: 'A-yuv-nvenc', kind: 'pipe', format: 'yuv', encoder: 'nvenc' },
  { name: 'A-yuv-x264', kind: 'pipe', format: 'yuv', encoder: 'x264' },
  { name: 'B-webcodecs-hw', kind: 'webcodecs', accel: 'prefer-hardware' },
  { name: 'B-webcodecs-sw', kind: 'webcodecs', accel: 'prefer-software' },
];

const logEl = document.getElementById('log')!;
function log(message: string): void {
  console.log(message);
  logEl.textContent += `${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
const seconds = (ms: number) => +(ms / 1000).toFixed(2);
const round = (x: number, digits = 1) => +x.toFixed(digits);

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1]) };
}

async function preview(c: Compositor, media: Demuxed) {
  const src = new FrameSource(media);
  const N = 300;

  let t0 = performance.now();
  for await (const { frame, index } of src.frames(START_FRAME, N)) {
    c.render(frame, index - START_FRAME);
    frame.close();
    c.present();
  }
  await c.finish();
  const uncappedFps = round(N / ((performance.now() - t0) / 1000));

  // Paced playback: each frame has a due time; count the ones we submit late.
  let late = 0;
  const lateness: number[] = [];
  let k = 0;
  t0 = (await raf()) + 100;
  for await (const { frame, index } of src.frames(START_FRAME, N)) {
    const due = t0 + (k++ * 1000) / FPS;
    while (performance.now() < due - 8) await raf();
    c.render(frame, index - START_FRAME);
    frame.close();
    c.present();
    const lateBy = performance.now() - due;
    lateness.push(Math.max(0, lateBy));
    if (lateBy > 1000 / FPS) late++;
  }
  src.close();

  const result = { uncappedFps, pacedFrames: N, lateFrames: late, latenessMs: stats(lateness) };
  log(`preview: ${JSON.stringify(result)}`);
  return result;
}

async function seek(c: Compositor, only: string[] | undefined) {
  const variants = ['work-g1.mp4', 'work-g15.mp4', 'work-g30.mp4', 'work-g60.mp4', 'work-g30-nvenc.mp4'];
  const results: Record<string, unknown> = {};

  for (const name of variants.filter((v) => !only || only.includes(v))) {
    const media = await demux(await readFile(path.join(dir, name)), name);
    const src = new FrameSource(media);

    let t0 = performance.now();
    let n = 0;
    for await (const { frame } of src.frames(0, 600)) {
      frame.close();
      n++;
    }
    const decodeFps = round(n / ((performance.now() - t0) / 1000));

    // Deterministic pseudo-random targets so runs are comparable.
    let seed = 12345;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    (await src.seek(0)).close();

    const times: number[] = [];
    let correct = 0;
    const TARGETS = 25;
    for (let i = 0; i < TARGETS; i++) {
      const target = Math.floor(rand() * SRC_FRAMES);
      t0 = performance.now();
      const frame = await src.seek(target);
      c.render(frame, 0);
      frame.close();
      const row = c.readRow(PROBE.srcBitsRow); // forces the GPU to finish
      times.push(performance.now() - t0);
      if (readBits((b) => row[PROBE.bitX(b) * 4 + 1]) === target) correct++;
    }
    c.present();
    src.close();

    results[name] = { decodeFps, seekMs: stats(times), frameAccurate: `${correct}/${TARGETS}` };
    log(`seek ${name}: ${JSON.stringify(results[name])}`);
  }
  return results;
}

function encoderArgs(encoder: 'nvenc' | 'x264'): string[] {
  return encoder === 'nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '19',
       '-b:v', '16M', '-maxrate', '24M', '-bufsize', '32M', '-profile:v', 'high']
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-profile:v', 'high'];
}

/** Audio for the exported range, cut straight from the working file. */
const AUDIO_INPUT = ['-ss', String(START_FRAME / FPS), '-t', String(FRAME_COUNT / FPS), '-i', WORKING];
const AUDIO_OUTPUT = ['-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];

function ffmpeg(args: string[]) {
  const child = spawn(ffmpegExe(), ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}: ${stderr}`))));
  });
  return { child, done };
}

async function saveReference(c: Compositor, runDir: string, outIndex: number) {
  if (SAMPLE_FRAMES.includes(outIndex)) await writeFile(path.join(runDir, `ref-${outIndex}.rgba`), c.readRgba());
}

async function exportPipe(c: Compositor, media: Demuxed, run: Extract<ExportRun, { kind: 'pipe' }>, runDir: string) {
  const input = run.format === 'rgba'
    ? ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${OUT_W}x${OUT_H}`, '-r', String(FPS), '-i', 'pipe:0']
    : ['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${OUT_W}x${OUT_H}`, '-r', String(FPS), ...COLOR_TAGS, '-i', 'pipe:0'];
  const convert = run.format === 'rgba' ? ['-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p'] : [];
  const { child, done } = ffmpeg([
    ...input, ...AUDIO_INPUT, ...AUDIO_OUTPUT, ...convert, ...encoderArgs(run.encoder), '-g', '60', ...COLOR_TAGS,
    path.join(runDir, 'out.mp4'),
  ]);

  const bytes = run.format === 'rgba' ? RGBA_BYTES : YUV_BYTES;
  const SLOTS = 3;
  const pending: number[] = [];
  let slot = 0;
  const wait = { collectMs: 0, writeMs: 0 };

  const flushOne = async () => {
    let t = performance.now();
    const data = await c.collect(pending.shift()!, new Uint8Array(bytes));
    wait.collectMs += performance.now() - t;
    t = performance.now();
    if (!child.stdin!.write(data)) await once(child.stdin!, 'drain');
    wait.writeMs += performance.now() - t;
  };

  const src = new FrameSource(media);
  const t0 = performance.now();
  let frames = 0;
  for await (const { frame, index } of src.frames(START_FRAME, FRAME_COUNT)) {
    const outIndex = index - START_FRAME;
    c.render(frame, outIndex);
    frame.close();
    await saveReference(c, runDir, outIndex);
    if (pending.length === SLOTS) await flushOne();
    c.startReadback(run.format, slot);
    pending.push(slot);
    slot = (slot + 1) % SLOTS;
    if (outIndex % 30 === 0) c.present();
    frames++;
  }
  while (pending.length > 0) await flushOne();
  child.stdin!.end();
  await done;
  src.close();

  const elapsed = performance.now() - t0;
  return { frames, seconds: seconds(elapsed), fps: round(frames / (elapsed / 1000)), waitSeconds: { collect: seconds(wait.collectMs), write: seconds(wait.writeMs) } };
}

function webCodecsConfig(accel: HardwareAcceleration): VideoEncoderConfig {
  return {
    codec: 'avc1.640032', // High profile, level 5.0
    width: OUT_W,
    height: OUT_H,
    framerate: FPS,
    bitrate: 16_000_000,
    bitrateMode: 'variable',
    hardwareAcceleration: accel,
    latencyMode: 'quality',
    avc: { format: 'annexb' },
  };
}

async function exportWebCodecs(c: Compositor, media: Demuxed, run: Extract<ExportRun, { kind: 'webcodecs' }>, runDir: string) {
  const config = webCodecsConfig(run.accel);
  const support = await VideoEncoder.isConfigSupported(config);
  if (!support.supported) return { skipped: 'config not supported' };

  const h264Path = path.join(runDir, 'video.h264');
  const file = createWriteStream(h264Path);
  let encodeError: Error | undefined;
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      file.write(data);
    },
    error: (e) => (encodeError = e),
  });
  encoder.configure(config);

  const src = new FrameSource(media);
  const t0 = performance.now();
  let frames = 0;
  for await (const { frame, index } of src.frames(START_FRAME, FRAME_COUNT)) {
    const outIndex = index - START_FRAME;
    c.render(frame, outIndex);
    frame.close();
    await saveReference(c, runDir, outIndex);
    c.present();
    const vf = new VideoFrame(c.canvas, { timestamp: (outIndex * 1e6) / FPS, duration: 1e6 / FPS });
    encoder.encode(vf, { keyFrame: outIndex % 60 === 0 });
    vf.close();
    while (encoder.encodeQueueSize > 4) {
      await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
    }
    if (encodeError) throw encodeError;
    frames++;
  }
  await encoder.flush();
  encoder.close();
  src.close();
  file.end();
  await once(file, 'finish');
  const encodeElapsed = performance.now() - t0;

  const { done } = ffmpeg([
    '-framerate', String(FPS), '-f', 'h264', '-i', h264Path, ...AUDIO_INPUT, ...AUDIO_OUTPUT, '-c:v', 'copy',
    path.join(runDir, 'out.mp4'),
  ]);
  await done;
  const elapsed = performance.now() - t0;

  return {
    frames,
    seconds: seconds(elapsed),
    fps: round(frames / (elapsed / 1000)),
    encodeSeconds: seconds(encodeElapsed),
  };
}

async function exports(c: Compositor, media: Demuxed, only: string[] | undefined) {
  const results: Record<string, unknown> = {};
  for (const run of EXPORTS) {
    if (only && !only.includes(run.name)) continue;
    const runDir = path.join(dir, 'runs', run.name);
    await mkdir(runDir, { recursive: true });
    log(`export ${run.name}...`);
    try {
      const r = run.kind === 'pipe' ? await exportPipe(c, media, run, runDir) : await exportWebCodecs(c, media, run, runDir);
      results[run.name] = r;
      await writeFile(path.join(runDir, 'meta.json'), JSON.stringify({ run, result: r }, null, 2));
      log(`export ${run.name}: ${JSON.stringify(r)}`);
    } catch (e) {
      results[run.name] = { error: String(e) };
      log(`export ${run.name} FAILED: ${e}`);
    }
  }
  return results;
}

async function encoderSupport() {
  const out: Record<string, unknown> = {};
  for (const accel of ['prefer-hardware', 'prefer-software'] as const) {
    const s = await VideoEncoder.isConfigSupported(webCodecsConfig(accel));
    out[accel] = s.supported;
  }
  return out;
}

async function main() {
  const args = new URLSearchParams(location.search).get('args') ?? '';
  const runs = (args.match(/--run=(\S+)/)?.[1] ?? 'preview,seek,export').split(',');
  const only = args.match(/--only=(\S+)/)?.[1]?.split(',');

  const resultsPath = path.join(dir, 'results.json');
  const results: Record<string, unknown> = await readFile(resultsPath, 'utf8').then(JSON.parse, () => ({}));
  results.environment = {
    date: new Date().toISOString(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    gpu: await ipcRenderer.invoke('gpu-info'),
    webCodecsEncoder: await encoderSupport(),
  };

  const c = new Compositor(document.getElementById('view') as HTMLCanvasElement);
  const media = await demux(await readFile(WORKING), WORKING);
  log(`working file: ${media.samples.length} frames, ${media.config.codec}`);

  if (runs.includes('preview')) results.preview = await preview(c, media);
  if (runs.includes('seek')) results.seek = await seek(c, only);
  if (runs.includes('export')) results.exports = { ...(results.exports as object), ...(await exports(c, media, only)) };

  await writeFile(resultsPath, JSON.stringify(results, null, 2));
  log(`results written to ${resultsPath}`);
}

main().then(
  () => ipcRenderer.send('done', 0),
  (e) => {
    console.error(e?.stack ?? String(e));
    ipcRenderer.send('done', 1);
  },
);
