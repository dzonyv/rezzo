/**
 * The WebGL2 renderer, generalised from the Phase 0 export lab
 * (spikes/export/lab/gl.ts). It draws a FrameRecipe (shared/framing.ts)
 * into an offscreen 1080×1920 texture, "comp". The preview shows comp on a
 * canvas; the export (Phase 1c) will convert comp to YUV and read it back,
 * so both see the same pixels.
 *
 * Inside the offscreen textures row 0 is the TOP of the image, so output
 * rectangles (origin top left) map straight to framebuffer rows, and a
 * readback returns rows in the order FFmpeg expects. Only the final draw
 * to the canvas flips to WebGL's bottom-up convention.
 */
import { cropRect, OUTPUT, type FrameRecipe, type Size } from '../../../shared/framing.ts';

/** The blurred background is drawn at a quarter of the output size. */
const BG_W = OUTPUT.width / 4;
const BG_H = OUTPUT.height / 4;
/** How much the blurred background is darkened, so the picture stands out. */
const BG_DIM = 0.6;
/** A yuv420p frame packed four bytes per RGBA pixel: Y rows, then U, then V. */
const PACK_W = OUTPUT.width / 4;
const PACK_H = OUTPUT.height * 1.5;
/** Bytes in one exported frame. */
export const YUV_BYTES = OUTPUT.width * OUTPUT.height * 1.5;

const VERT = `#version 300 es
void main() {
  // One triangle that covers the whole viewport.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
out vec4 o;
`;

/** Part of the source (uRect, in texture coordinates) stretched over the whole target. */
const COVER = `${HEADER}
uniform sampler2D uSrc;
uniform vec4 uRect;
uniform vec2 uSize;
void main() {
  vec2 f = gl_FragCoord.xy / uSize;
  o = vec4(texture(uSrc, uRect.xy + f * uRect.zw).rgb, 1.0);
}`;

/** One direction of a separable 9-tap Gaussian, two texels per step. */
const BLUR = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uDir;
uniform vec2 uSize;
const float W[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main() {
  vec2 uv = gl_FragCoord.xy / uSize;
  vec3 c = texture(uTex, uv).rgb * W[0];
  for (int i = 1; i < 5; i++) {
    vec2 d = uDir * float(i) * 2.0 / uSize;
    c += (texture(uTex, uv + d).rgb + texture(uTex, uv - d).rgb) * W[i];
  }
  o = vec4(c, 1.0);
}`;

const BACKGROUND = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uSize;
void main() {
  o = vec4(texture(uTex, gl_FragCoord.xy / uSize).rgb * ${BG_DIM.toFixed(2)}, 1.0);
}`;

/** Source rectangle uSrcRect drawn into output rectangle uDstRect (pixels); the scissor limits it. */
const DRAW = `${HEADER}
uniform sampler2D uSrc;
uniform vec4 uSrcRect;
uniform vec4 uDstRect;
void main() {
  vec2 f = (gl_FragCoord.xy - uDstRect.xy) / uDstRect.zw;
  o = vec4(texture(uSrc, uSrcRect.xy + f * uSrcRect.zw).rgb, 1.0);
}`;

const DISPLAY = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uSize;
void main() {
  vec2 f = gl_FragCoord.xy / uSize;
  o = texture(uTex, vec2(f.x, 1.0 - f.y));
}`;

/**
 * RGB -> BT.709 limited-range Y'CbCr, 4:2:0, laid out exactly like FFmpeg's
 * yuv420p: the Y plane, then U, then V. Each output pixel holds four
 * consecutive bytes of that buffer. From the Phase 0 export lab.
 */
const PACK_YUV = `${HEADER}
uniform sampler2D uComp;
const vec3 K = vec3(0.2126, 0.7152, 0.0722);
const int W = ${OUTPUT.width};
const int H = ${OUTPUT.height};
const int CW = ${OUTPUT.width / 2};

vec3 rgb(int x, int y) { return texelFetch(uComp, ivec2(x, y), 0).rgb; }

float luma(int x, int y) { return 16.0 + 219.0 * dot(rgb(x, y), K); }

vec2 chroma(int cx, int cy) {
  vec3 c = (rgb(2 * cx, 2 * cy) + rgb(2 * cx + 1, 2 * cy) + rgb(2 * cx, 2 * cy + 1) + rgb(2 * cx + 1, 2 * cy + 1)) * 0.25;
  float y = dot(c, K);
  return vec2(128.0 + 224.0 * (c.b - y) / 1.8556, 128.0 + 224.0 * (c.r - y) / 1.5748);
}

void main() {
  int col = int(gl_FragCoord.x);
  int row = int(gl_FragCoord.y);
  vec4 v;
  for (int k = 0; k < 4; k++) {
    if (row < H) {
      v[k] = luma(col * 4 + k, row);
    } else {
      int plane = row < H + H / 4 ? 0 : 1;
      int offset = (row - H - plane * (H / 4)) * W + col * 4 + k;
      vec2 c = chroma(offset % CW, offset / CW);
      v[k] = plane == 0 ? c.x : c.y;
    }
  }
  o = clamp(floor(v + 0.5), 0.0, 255.0) / 255.0;
}`;

interface Target {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

type Uniforms = Record<string, WebGLTexture | number[]>;

const mipLevels = (w: number, h: number) => Math.floor(Math.log2(Math.max(w, h))) + 1;

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private src: { tex: WebGLTexture; w: number; h: number } | undefined;
  private comp: Target;
  private bgA: Target;
  private bgB: Target;
  private programs: Record<'cover' | 'blur' | 'background' | 'draw' | 'display', WebGLProgram>;
  /** Made on the first readback: only the export needs them. */
  private packer: { program: WebGLProgram; yuv: Target } | undefined;
  private pbos: { buf: WebGLBuffer; sync: WebGLSync | null }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    // Mipmaps keep the comp from shimmering when the preview shows it small.
    this.comp = this.target(OUTPUT.width, OUTPUT.height, mipLevels(OUTPUT.width, OUTPUT.height));
    this.bgA = this.target(BG_W, BG_H, 1);
    this.bgB = this.target(BG_W, BG_H, 1);
    this.programs = {
      cover: this.program(COVER),
      blur: this.program(BLUR),
      background: this.program(BACKGROUND),
      draw: this.program(DRAW),
      display: this.program(DISPLAY),
    };
    gl.bindVertexArray(gl.createVertexArray());
  }

  /** Size of the last uploaded source frame, or null before the first one. */
  get sourceSize(): Size | null {
    return this.src ? { width: this.src.w, height: this.src.h } : null;
  }

  /** Copies a decoded frame into the source texture. The caller can close the frame right after. */
  upload(frame: VideoFrame): void {
    const gl = this.gl;
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (!this.src || this.src.w !== w || this.src.h !== h) {
      if (this.src) gl.deleteTexture(this.src.tex);
      this.src = { tex: this.texture(w, h, mipLevels(w, h)), w, h };
    }
    gl.bindTexture(gl.TEXTURE_2D, this.src.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    // Full-frame layouts scale a large source down; mipmaps keep that clean.
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  /** Draws one output frame from the uploaded source into comp. */
  render(recipe: FrameRecipe): void {
    const gl = this.gl;
    const src = this.src;
    if (!src) return;
    if (recipe.background === 'blur') {
      const r = cropRect({ x: 0.5, y: 0.5, zoom: 1 }, OUTPUT.width / OUTPUT.height, { width: src.w, height: src.h });
      this.pass(this.programs.cover, this.bgA, { uSrc: src.tex, uRect: [r.x, r.y, r.w, r.h], uSize: [BG_W, BG_H] });
      for (let i = 0; i < 2; i++) {
        this.pass(this.programs.blur, this.bgB, { uTex: this.bgA.tex, uDir: [1, 0], uSize: [BG_W, BG_H] });
        this.pass(this.programs.blur, this.bgA, { uTex: this.bgB.tex, uDir: [0, 1], uSize: [BG_W, BG_H] });
      }
      this.pass(this.programs.background, this.comp, { uTex: this.bgA.tex, uSize: [OUTPUT.width, OUTPUT.height] });
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.comp.fbo);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.enable(gl.SCISSOR_TEST);
    for (const { src: s, dst: d } of recipe.draws) {
      const x0 = Math.round(d.x);
      const y0 = Math.round(d.y);
      gl.scissor(x0, y0, Math.round(d.x + d.w) - x0, Math.round(d.y + d.h) - y0);
      this.pass(this.programs.draw, this.comp, { uSrc: src.tex, uSrcRect: [s.x, s.y, s.w, s.h], uDstRect: [d.x, d.y, d.w, d.h] });
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  /** Shows comp on the canvas, scaled to the canvas's drawing buffer. */
  present(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.comp.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    const size = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    this.pass(this.programs.display, null, { uTex: this.comp.tex, uSize: size });
  }

  /** Reads one row of comp, top row 0 (for tests). */
  readRow(y: number): Uint8Array {
    const gl = this.gl;
    const dst = new Uint8Array(OUTPUT.width * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.comp.fbo);
    gl.readPixels(0, y, OUTPUT.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, dst);
    return dst;
  }

  /**
   * Converts comp to yuv420p and starts reading it back into pixel buffer
   * `slot` without waiting for the GPU. collect(slot) picks the bytes up
   * later, so rendering the next frames overlaps the readback.
   */
  startReadback(slot: number): void {
    const gl = this.gl;
    this.packer ??= { program: this.program(PACK_YUV), yuv: this.target(PACK_W, PACK_H, 1, gl.NEAREST) };
    while (this.pbos.length <= slot) {
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buf);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, YUV_BYTES, gl.STREAM_READ);
      this.pbos.push({ buf, sync: null });
    }
    const pbo = this.pbos[slot]!;
    const { program, yuv } = this.packer;
    this.pass(program, yuv, { uComp: this.comp.tex });
    gl.bindFramebuffer(gl.FRAMEBUFFER, yuv.fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buf);
    gl.readPixels(0, 0, PACK_W, PACK_H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pbo.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  /** Waits for the readback started in `slot` and copies it into `dst` (YUV_BYTES long). */
  async collect(slot: number, dst: Uint8Array): Promise<Uint8Array> {
    const gl = this.gl;
    const pbo = this.pbos[slot];
    if (!pbo?.sync) throw new Error(`no readback in slot ${slot}`);
    while (gl.clientWaitSync(pbo.sync, 0, 0) === gl.TIMEOUT_EXPIRED) await yieldToEventLoop();
    gl.deleteSync(pbo.sync);
    pbo.sync = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, dst);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return dst;
  }

  /**
   * Frees what this compositor made, but leaves the context alone: a canvas
   * has one WebGL context for its whole life, and the next compositor on the
   * same canvas (React mounts effects twice in development) gets that same
   * context back. Losing it here would hand the next one a dead context.
   */
  dispose(): void {
    const gl = this.gl;
    for (const t of [this.comp, this.bgA, this.bgB]) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    if (this.src) gl.deleteTexture(this.src.tex);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p);
    if (this.packer) {
      gl.deleteProgram(this.packer.program);
      gl.deleteFramebuffer(this.packer.yuv.fbo);
      gl.deleteTexture(this.packer.yuv.tex);
    }
    for (const pbo of this.pbos) {
      if (pbo.sync) gl.deleteSync(pbo.sync);
      gl.deleteBuffer(pbo.buf);
    }
    this.src = undefined;
    this.packer = undefined;
    this.pbos = [];
  }

  private pass(program: WebGLProgram, target: Target | null, uniforms: Uniforms): void {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0, 0, target?.w ?? gl.drawingBufferWidth, target?.h ?? gl.drawingBufferHeight);
    let unit = 0;
    for (const [name, value] of Object.entries(uniforms)) {
      const at = gl.getUniformLocation(program, name);
      if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2f(at, value[0]!, value[1]!);
        else gl.uniform4f(at, value[0]!, value[1]!, value[2]!, value[3]!);
      } else {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.uniform1i(at, unit++);
      }
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private texture(w: number, h: number, levels: number, filter: number = this.gl.LINEAR): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private target(w: number, h: number, levels: number, filter?: number): Target {
    const gl = this.gl;
    const tex = this.texture(w, h, levels, filter);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  }

  private program(fragment: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    return p;
  }
}

const channel = new MessageChannel();
const waiters: (() => void)[] = [];
channel.port1.onmessage = () => waiters.shift()?.();

/** Lets other work run while the GPU finishes; faster than setTimeout(0), which Chromium clamps. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    waiters.push(resolve);
    channel.port2.postMessage(null);
  });
}
