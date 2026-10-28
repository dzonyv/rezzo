/**
 * WebGL2 compositor for the "full frame over blurred background" layout.
 *
 * Every frame is first drawn into an offscreen 1080x1920 texture ("comp").
 * From there it is either shown on the canvas (preview), read back as RGBA,
 * or converted to YUV 4:2:0 on the GPU and read back (export). Preview and
 * export therefore share every pixel of the rendering.
 *
 * Inside the offscreen textures row 0 is the TOP of the image, so readPixels
 * returns rows in the order FFmpeg expects. Only the final blit to the canvas
 * flips to WebGL's bottom-up convention.
 */
import {
  FG_RECT, OUT_BIT_W, OUT_BITS_Y0, OUT_H, OUT_W, SRC_H, SRC_W,
} from '../layout.ts';

const BG_W = OUT_W / 4;
const BG_H = OUT_H / 4;

/** YUV 4:2:0 planar frame packed four bytes per RGBA pixel. */
const PACK_W = OUT_W / 4;
const PACK_H = OUT_H * 1.5;
export const YUV_BYTES = OUT_W * OUT_H * 1.5;
export const RGBA_BYTES = OUT_W * OUT_H * 4;

const VERT = `#version 300 es
void main() {
  // One triangle that covers the whole viewport.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
precision highp int;
out vec4 o;
`;

/** Source scaled to cover the output, sampled at quarter resolution. */
const COVER = `${HEADER}
uniform sampler2D uSrc;
void main() {
  vec2 f = gl_FragCoord.xy / vec2(${BG_W}.0, ${BG_H}.0);
  float visibleW = ${SRC_H}.0 * ${OUT_W}.0 / ${OUT_H}.0;
  vec2 src = vec2((${SRC_W}.0 - visibleW) * 0.5 + f.x * visibleW, f.y * ${SRC_H}.0);
  o = vec4(texture(uSrc, src / vec2(${SRC_W}.0, ${SRC_H}.0)).rgb, 1.0);
}`;

/** One direction of a separable 9-tap Gaussian. */
const BLUR = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uDir;
const float W[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main() {
  vec2 size = vec2(${BG_W}.0, ${BG_H}.0);
  vec2 uv = gl_FragCoord.xy / size;
  vec3 c = texture(uTex, uv).rgb * W[0];
  for (int i = 1; i < 5; i++) {
    vec2 d = uDir * float(i) * 2.0 / size;
    c += (texture(uTex, uv + d).rgb + texture(uTex, uv - d).rgb) * W[i];
  }
  o = vec4(c, 1.0);
}`;

const COMPOSITE = `${HEADER}
uniform sampler2D uSrc;
uniform sampler2D uBg;
uniform int uFrame;
void main() {
  vec2 p = gl_FragCoord.xy;
  if (p.y >= ${OUT_BITS_Y0}.0) {
    int bit = int(p.x / ${OUT_BIT_W});
    o = vec4(vec3(float((uFrame >> bit) & 1)), 1.0);
    return;
  }
  vec2 f = (p - vec2(${FG_RECT.x}.0, ${FG_RECT.y})) / vec2(${FG_RECT.w}.0, ${FG_RECT.h});
  if (all(greaterThanEqual(f, vec2(0.0))) && all(lessThan(f, vec2(1.0)))) {
    o = vec4(texture(uSrc, f).rgb, 1.0);
  } else {
    o = vec4(texture(uBg, p / vec2(${OUT_W}.0, ${OUT_H}.0)).rgb * 0.55, 1.0);
  }
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
 * consecutive bytes of that buffer.
 */
const PACK_YUV = `${HEADER}
uniform sampler2D uComp;
const vec3 K = vec3(0.2126, 0.7152, 0.0722);
const int W = ${OUT_W};
const int H = ${OUT_H};
const int CW = ${OUT_W / 2};

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

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private src: WebGLTexture;
  private comp: Target;
  private bgA: Target;
  private bgB: Target;
  private yuv: Target;
  private programs: Record<'cover' | 'blur' | 'composite' | 'display' | 'pack', WebGLProgram>;
  private pbos: { buf: WebGLBuffer; sync: WebGLSync | null; bytes: number }[] = [];

  readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      depth: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl;

    this.src = this.texture(SRC_W, SRC_H, gl.LINEAR);
    this.comp = this.target(OUT_W, OUT_H, gl.LINEAR);
    this.bgA = this.target(BG_W, BG_H, gl.LINEAR);
    this.bgB = this.target(BG_W, BG_H, gl.LINEAR);
    this.yuv = this.target(PACK_W, PACK_H, gl.NEAREST);
    this.programs = {
      cover: this.program(COVER),
      blur: this.program(BLUR),
      composite: this.program(COMPOSITE),
      display: this.program(DISPLAY),
      pack: this.program(PACK_YUV),
    };
    gl.bindVertexArray(gl.createVertexArray());
  }

  /** Renders one output frame into the offscreen comp texture. */
  render(frame: VideoFrame, outputIndex: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);

    this.pass(this.programs.cover, this.bgA, { uSrc: this.src });
    for (let i = 0; i < 2; i++) {
      this.pass(this.programs.blur, this.bgB, { uTex: this.bgA.tex }, { uDir: [1, 0] });
      this.pass(this.programs.blur, this.bgA, { uTex: this.bgB.tex }, { uDir: [0, 1] });
    }
    this.pass(this.programs.composite, this.comp, { uSrc: this.src, uBg: this.bgA.tex }, {}, { uFrame: outputIndex });
  }

  /** Shows the last rendered frame on the canvas. */
  present(): void {
    this.pass(this.programs.display, null, { uTex: this.comp.tex }, { uSize: [OUT_W, OUT_H] });
  }

  /** Synchronous RGBA readback of the comp texture (top row first). */
  readRgba(dst = new Uint8Array(RGBA_BYTES)): Uint8Array {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.comp.fbo);
    gl.readPixels(0, 0, OUT_W, OUT_H, gl.RGBA, gl.UNSIGNED_BYTE, dst);
    return dst;
  }

  /** Reads one row of the comp texture, e.g. to decode a frame-number strip. */
  readRow(y: number): Uint8Array {
    const gl = this.gl;
    const dst = new Uint8Array(OUT_W * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.comp.fbo);
    gl.readPixels(0, y, OUT_W, 1, gl.RGBA, gl.UNSIGNED_BYTE, dst);
    return dst;
  }

  /**
   * Starts an asynchronous readback into a pixel buffer object. Returns a
   * slot to pass to collect(); the GPU keeps working while we wait.
   */
  startReadback(format: 'rgba' | 'yuv', slot: number): void {
    const gl = this.gl;
    while (this.pbos.length <= slot) this.pbos.push({ buf: gl.createBuffer()!, sync: null, bytes: 0 });
    const pbo = this.pbos[slot];
    const bytes = format === 'rgba' ? RGBA_BYTES : YUV_BYTES;
    // Allocate storage once per slot and size, not on every frame. Chromium
    // then logs a "shadow copy discarded" performance warning per readback,
    // but measured end to end this is faster (x264 path 182 -> 231 fps).
    const allocate = pbo.bytes !== bytes;
    pbo.bytes = bytes;

    let src = this.comp;
    if (format === 'yuv') {
      this.pass(this.programs.pack, this.yuv, { uComp: this.comp.tex });
      src = this.yuv;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buf);
    if (allocate) gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.readPixels(0, 0, src.w, src.h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    pbo.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  async collect(slot: number, dst: Uint8Array): Promise<Uint8Array> {
    const gl = this.gl;
    const pbo = this.pbos[slot];
    while (gl.clientWaitSync(pbo.sync!, 0, 0) === gl.TIMEOUT_EXPIRED) {
      await yieldToEventLoop();
    }
    gl.deleteSync(pbo.sync!);
    pbo.sync = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo.buf);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, dst);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return dst;
  }

  /** Waits until the GPU has finished all submitted work. */
  async finish(): Promise<void> {
    const gl = this.gl;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!;
    gl.flush();
    while (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) await yieldToEventLoop();
    gl.deleteSync(sync);
  }

  private pass(
    program: WebGLProgram,
    target: Target | null,
    textures: Record<string, WebGLTexture>,
    vec2s: Record<string, [number, number]> = {},
    ints: Record<string, number> = {},
  ): void {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0, 0, target?.w ?? this.canvas.width, target?.h ?? this.canvas.height);
    let unit = 0;
    for (const [name, tex] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(gl.getUniformLocation(program, name), unit++);
    }
    for (const [name, v] of Object.entries(vec2s)) gl.uniform2f(gl.getUniformLocation(program, name), v[0], v[1]);
    for (const [name, v] of Object.entries(ints)) gl.uniform1i(gl.getUniformLocation(program, name), v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private texture(w: number, h: number, filter: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private target(w: number, h: number, filter: number): Target {
    const gl = this.gl;
    const tex = this.texture(w, h, filter);
    const fbo = gl.createFramebuffer()!;
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
    const p = gl.createProgram()!;
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

/** Faster than setTimeout(0), which Chromium clamps to ~1-4 ms. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    waiters.push(resolve);
    channel.port2.postMessage(null);
  });
}

