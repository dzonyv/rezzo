/**
 * Video-layer lab: decodes the main working file and N stacked-alpha
 * overlay files in lockstep with WebCodecs, composites them in WebGL2 at
 * 1080x1920 and measures what Phase 3b needs to know:
 *
 *   alpha     does WebCodecs + WebGL give back the same alpha FFmpeg decodes?
 *   play      uncapped speed (the ceiling for export) and paced 30 fps
 *             playback (frames that miss their slot) for 0..8 overlays
 *   seek      paused seeks with every source seeking at once
 *
 * Uses the app's own FrameSource and demux (src/renderer/src/render) so the
 * numbers are the ones the app will see. Results go to <media>/layers/lab.json.
 *
 *   npm run layers:lab
 *   npm run layers:lab -- --accel=hw      overlays must decode on the GPU
 *   npm run layers:lab -- --run=alpha
 */
import { ipcRenderer } from 'electron';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mediaDir } from '../../shared/paths.ts';
import { ffmpegExe } from '../../shared/tools.ts';
import { demux, type Demuxed } from '../../../src/renderer/src/render/demux.ts';
import { FrameSource } from '../../../src/renderer/src/render/frame-source.ts';

const dir = path.join(mediaDir, 'layers');
const MAIN = path.join(mediaDir, 'ipc', 'work', 'clip-a-x264.mp4');
const OVERLAYS = {
  '1080': { file: path.join(dir, 'overlay-1080.mp4'), contentH: 1080 },
  '720': { file: path.join(dir, 'overlay-720.mp4'), contentH: 720 },
  vertical: { file: path.join(dir, 'overlay-vertical.mp4'), contentH: 1920 },
};
type OverlaySize = keyof typeof OVERLAYS;

const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const N = 300;

const logEl = document.getElementById('log')!;
function log(message: string): void {
  console.log(message);
  logEl.textContent += `${message}\n`;
  logEl.scrollTop = logEl.scrollHeight;
}

const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
const round = (x: number, digits = 1) => +x.toFixed(digits);

function stats(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { median: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1]) };
}

// --- WebGL ---------------------------------------------------------------

const VERT = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** The main video, scaled to cover 9:16 and cropped in the middle. */
const MAIN_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSrc;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, ${OUT_H}.0 - gl_FragCoord.y) / vec2(${OUT_W}.0, ${OUT_H}.0);
  float visibleW = uSrc.y * ${OUT_W}.0 / ${OUT_H}.0 / uSrc.x;
  o = vec4(texture(uTex, vec2(0.5 - visibleW * 0.5 + p.x * visibleW, p.y)).rgb, 1.0);
}`;

/**
 * A stacked overlay: colour from the top half, alpha from the luma of the
 * bottom half (BT.709 weights undo whatever chroma the encoder left there). Rows are clamped to the content of each half so linear
 * filtering never reaches across the seam or into the padding. Output is
 * premultiplied, blended with ONE, ONE_MINUS_SRC_ALPHA.
 */
const OVERLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uRect;      // x, y, w, h in output pixels, y down
uniform float uContent;  // content rows / coded rows
uniform float uAlphaAt;  // first row of the alpha half / coded rows
uniform float uTexelY;
const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
out vec4 o;
void main() {
  vec2 f = (vec2(gl_FragCoord.x, ${OUT_H}.0 - gl_FragCoord.y) - uRect.xy) / uRect.zw;
  if (any(lessThan(f, vec2(0.0))) || any(greaterThanEqual(f, vec2(1.0)))) discard;
  float y = clamp(f.y * uContent, 0.5 * uTexelY, uContent - 0.5 * uTexelY);
  vec3 c = texture(uTex, vec2(f.x, y)).rgb;
  float a = dot(texture(uTex, vec2(f.x, uAlphaAt + y)).rgb, LUMA);
  o = vec4(c * a, a);
}`;

/** Copies a texture 1:1 into the bound framebuffer, row 0 = top row of the image. */
const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
out vec4 o;
void main() { o = texelFetch(uTex, ivec2(gl_FragCoord.xy), 0); }`;

class Gl {
  readonly gl: WebGL2RenderingContext;
  private main: WebGLProgram;
  private overlay: WebGLProgram;
  private copy: WebGLProgram;
  private textures: WebGLTexture[] = [];

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('no WebGL2');
    this.gl = gl;
    this.main = this.program(MAIN_FS);
    this.overlay = this.program(OVERLAY_FS);
    this.copy = this.program(COPY_FS);
    gl.bindVertexArray(gl.createVertexArray());
  }

  texture(i: number): WebGLTexture {
    const gl = this.gl;
    while (this.textures.length <= i) {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.push(t);
    }
    return this.textures[i];
  }

  /** Uploads a decoded frame into texture `i` and closes the frame right away. */
  upload(i: number, frame: VideoFrame): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture(i));
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    frame.close();
  }

  drawMain(srcW: number, srcH: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, OUT_W, OUT_H);
    gl.disable(gl.BLEND);
    gl.useProgram(this.main);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(0));
    gl.uniform2f(gl.getUniformLocation(this.main, 'uSrc'), srcW, srcH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  drawOverlay(i: number, rect: [number, number, number, number], contentH: number, codedH: number): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.overlay);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(i));
    const u = (n: string) => gl.getUniformLocation(this.overlay, n);
    gl.uniform4f(u('uRect'), ...rect);
    gl.uniform1f(u('uContent'), contentH / codedH);
    gl.uniform1f(u('uAlphaAt'), 0.5);
    gl.uniform1f(u('uTexelY'), 1 / codedH);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Draws texture `i` 1:1 into an offscreen RGBA8 target and reads it back, top row first. */
  readTexture(i: number, w: number, h: number): Uint8Array {
    const gl = this.gl;
    const target = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, target);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.copy);
    gl.bindTexture(gl.TEXTURE_2D, this.texture(i));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(target);
    return out;
  }

  /** Waits until the GPU has done everything submitted so far. */
  async finish(): Promise<void> {
    const gl = this.gl;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) await new Promise((r) => setTimeout(r, 0));
    gl.deleteSync(sync);
  }

  private program(fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }
}

// --- Scenes --------------------------------------------------------------

interface Scene {
  main: FrameSource;
  mainMedia: Demuxed;
  overlays: { src: FrameSource; media: Demuxed; contentH: number; rect: [number, number, number, number] }[];
}

/** Overlays spread over the frame, each 1080 wide, overlapping where there are many. */
function rectFor(i: number, count: number, contentH: number, contentW: number): [number, number, number, number] {
  const h = (OUT_W * contentH) / contentW;
  const y = count === 1 ? (OUT_H - h) / 2 : (i * (OUT_H - h)) / (count - 1);
  return [0, y, OUT_W, h];
}

function withAccel(media: Demuxed, accel: HardwareAcceleration): Demuxed {
  return { ...media, config: { ...media.config, hardwareAcceleration: accel } };
}

async function openScene(mainMedia: Demuxed, overlay: Demuxed, size: OverlaySize, count: number, accel: HardwareAcceleration): Promise<Scene> {
  const contentH = OVERLAYS[size].contentH;
  return {
    main: new FrameSource(mainMedia),
    mainMedia,
    overlays: Array.from({ length: count }, (_, i) => ({
      src: new FrameSource(withAccel(overlay, accel)),
      media: overlay,
      contentH,
      rect: rectFor(i, count, contentH, overlay.width),
    })),
  };
}

function closeScene(s: Scene): void {
  s.main.close();
  for (const o of s.overlays) o.src.close();
}

function draw(gl: Gl, s: Scene, frames: VideoFrame[]): void {
  frames.forEach((f, i) => gl.upload(i, f));
  gl.drawMain(s.mainMedia.width, s.mainMedia.height);
  s.overlays.forEach((o, i) => gl.drawOverlay(i + 1, o.rect, o.contentH, o.media.height));
}

/** Frames 0..N-1 of every source, in lockstep. */
async function* lockstep(s: Scene): AsyncGenerator<VideoFrame[]> {
  const gens = [s.main, ...s.overlays.map((o) => o.src)].map((src) => src.frames(0, N));
  for (let i = 0; i < N; i++) {
    const next = await Promise.all(gens.map((g) => g.next()));
    if (next.some((r) => r.done)) throw new Error(`a source ended early at frame ${i}`);
    yield next.map((r) => (r.value as { frame: VideoFrame }).frame);
  }
}

async function play(gl: Gl, s: Scene) {
  let t0 = performance.now();
  for await (const frames of lockstep(s)) draw(gl, s, frames);
  await gl.finish();
  const uncappedFps = round(N / ((performance.now() - t0) / 1000));

  // Paced: each frame has a due time; count the ones that are more than a frame late.
  let late = 0;
  const lateness: number[] = [];
  let k = 0;
  t0 = (await raf()) + 100;
  for await (const frames of lockstep(s)) {
    const due = t0 + (k++ * 1000) / FPS;
    while (performance.now() < due - 8) await raf();
    draw(gl, s, frames);
    const lateBy = performance.now() - due;
    lateness.push(Math.max(0, lateBy));
    if (lateBy > 1000 / FPS) late++;
  }
  await gl.finish();
  return { uncappedFps, lateFrames: late, latenessMs: stats(lateness) };
}

async function seek(gl: Gl, s: Scene) {
  let seed = 12345;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const target = Math.floor(rand() * N);
    const t0 = performance.now();
    const frames = await Promise.all([s.main, ...s.overlays.map((o) => o.src)].map((src) => src.seek(target)));
    draw(gl, s, frames);
    await gl.finish();
    times.push(performance.now() - t0);
  }
  return stats(times);
}

// --- Alpha check ---------------------------------------------------------

const luma = (b: Uint8Array, i: number) => 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];

function ffmpegFrame(file: string, index: number, w: number, h: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegExe(), [
      '-v', 'error', '-i', file, '-vf', `select='eq(n\\,${index})',scale=in_color_matrix=bt709:in_range=tv:flags=bilinear,format=rgba`,
      '-frames:v', '1', '-f', 'rawvideo', 'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      const b = Buffer.concat(chunks);
      if (code !== 0 || b.length !== w * h * 4) reject(new Error(`ffmpeg frame ${index}: exit ${code}, ${b.length} bytes`));
      else resolve(b);
    });
  });
}

/**
 * Compares the stacked overlay as WebCodecs + WebGL see it with FFmpeg's
 * decode of the same frame: alpha as luma of the bottom half (so chroma
 * upsampling, which differs between the two, cancels out), colour by PSNR.
 */
async function alphaCheck(gl: Gl, overlay: Demuxed, size: OverlaySize) {
  const { file, contentH } = OVERLAYS[size];
  const w = overlay.width;
  const h = overlay.height;
  const half = h / 2;
  const src = new FrameSource(overlay);
  const out: Record<string, unknown>[] = [];
  for (const index of [0, 45, 100]) {
    gl.upload(0, await src.seek(index));
    const got = gl.readTexture(0, w, h);
    const want = await ffmpegFrame(file, index, w, h);
    const hist = new Map<number, number>();
    let aMax = 0;
    let cSq = 0;
    const big = { count: 0, x0: Infinity, x1: -1, y0: Infinity, y1: -1, sample: [] as number[][] };
    for (let y = 0; y < contentH; y++) {
      for (let x = 0; x < w; x++) {
        const ia = ((half + y) * w + x) * 4;
        const d = Math.round(luma(got, ia)) - Math.round(luma(want, ia));
        hist.set(d, (hist.get(d) ?? 0) + 1);
        aMax = Math.max(aMax, Math.abs(d));
        if (Math.abs(d) > 1) {
          big.count++;
          big.x0 = Math.min(big.x0, x); big.x1 = Math.max(big.x1, x);
          big.y0 = Math.min(big.y0, y); big.y1 = Math.max(big.y1, y);
          if (big.sample.length < 6) big.sample.push([x, y, got[ia], got[ia + 1], got[ia + 2], want[ia], want[ia + 1], want[ia + 2]]);
        }
        const ic = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) cSq += (got[ic + c] - want[ic + c]) ** 2;
      }
    }
    const px = w * contentH;
    out.push({
      frame: index,
      alphaMaxDiff: aMax,
      bigDiff: big,
      alphaExact: round(((hist.get(0) ?? 0) / px) * 100, 2),
      alphaDiffHistogram: Object.fromEntries([...hist].sort((a, b) => a[0] - b[0])),
      colourPsnr: round(10 * Math.log10((255 * 255 * px * 3) / cSq)),
    });
  }
  src.close();
  log(`alpha ${size}: ${JSON.stringify(out)}`);
  return out;
}

// --- Main ----------------------------------------------------------------

async function main() {
  const args = new URLSearchParams(location.search).get('args') ?? '';
  const runs = (args.match(/--run=(\S+)/)?.[1] ?? 'alpha,play,seek').split(',');
  const accel: HardwareAcceleration = args.includes('--accel=hw') ? 'prefer-hardware' : 'no-preference';

  const resultsPath = path.join(dir, 'lab.json');
  const results: Record<string, any> = await readFile(resultsPath, 'utf8').then(JSON.parse, () => ({}));
  results.environment = {
    date: new Date().toISOString(),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    gpu: (await ipcRenderer.invoke('gpu-info'))?.gpuDevice,
  };

  const gl = new Gl(document.getElementById('view') as HTMLCanvasElement);
  const load = async (f: string) => {
    const b = await readFile(f);
    return demux(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  };
  const mainMedia = await load(MAIN);
  const overlays = {
    '1080': await load(OVERLAYS['1080'].file),
    '720': await load(OVERLAYS['720'].file),
    vertical: await load(OVERLAYS.vertical.file),
  };
  log(`main ${mainMedia.width}x${mainMedia.height}, ${mainMedia.samples.length} frames; overlays ${overlays['1080'].width}x${overlays['1080'].height}, ${overlays['720'].width}x${overlays['720'].height}, ${overlays.vertical.width}x${overlays.vertical.height}; accel ${accel}`);

  if (runs.includes('alpha')) {
    results.alpha = { '1080': await alphaCheck(gl, overlays['1080'], '1080'), '720': await alphaCheck(gl, overlays['720'], '720') };
  }

  const scenarios: [OverlaySize, number][] = [
    ['1080', 0], ['1080', 1], ['1080', 2], ['1080', 4], ['1080', 6], ['1080', 8],
    ['720', 1], ['720', 2], ['720', 4], ['720', 8],
    ['vertical', 1], ['vertical', 2], ['vertical', 4],
  ];
  if (runs.includes('play') || runs.includes('seek')) {
    const key = `scenes-${accel}`;
    results[key] = {};
    // Warm up shaders and the decoder before anything is timed.
    const warm = await openScene(mainMedia, overlays['720'], '720', 1, accel);
    await play(gl, warm);
    closeScene(warm);
    for (const [size, count] of scenarios) {
      const name = `${count}x${size}`;
      const s = await openScene(mainMedia, overlays[size], size, count, accel);
      const row: Record<string, unknown> = {};
      try {
        if (runs.includes('play')) row.play = await play(gl, s);
        if (runs.includes('seek')) row.seekMs = await seek(gl, s);
      } catch (e) {
        row.error = String(e);
      }
      closeScene(s);
      results[key][name] = row;
      log(`${name}: ${JSON.stringify(row)}`);
      await writeFile(resultsPath, JSON.stringify(results, null, 2));
    }
  }

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
