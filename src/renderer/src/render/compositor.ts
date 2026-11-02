/**
 * The WebGL2 renderer, generalised from the Phase 0 export lab
 * (spikes/export/lab/gl.ts). It draws a scene (shared/scene.ts) into an
 * offscreen 1080×1920 texture, "comp": the framed source video, then the
 * layers over it in order. The preview shows comp on a canvas; the export
 * converts comp to YUV and reads it back, so both see the same pixels.
 *
 * Images and video layers are drawn as quads, possibly turned, with soft
 * edges. A video layer's frame, and an image with a green screen, first go
 * through PREP into a premultiplied texture of their own: that's where a
 * stacked file's colour and alpha halves come together and where the
 * chroma key works. Captions arrive as a transparent canvas
 * (render/captions.ts). Everything is blended premultiplied, so
 * semi-transparent edges get no dark fringe.
 *
 * Inside the offscreen textures row 0 is the TOP of the image, so output
 * rectangles (origin top left) map straight to framebuffer rows, and a
 * readback returns rows in the order FFmpeg expects. Only the final draw
 * to the canvas flips to WebGL's bottom-up convention.
 */
import { chromaOf, rgbOf, type ChromaKey } from '../../../shared/chroma-key.ts';
import { cropRect, OUTPUT, type FrameRecipe, type Size } from '../../../shared/framing.ts';
import type { OverlayLayout } from '../../../shared/overlay-files.ts';
import type { Quad, SceneOp } from '../../../shared/scene.ts';
import type { Overlay } from './captions.ts';

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

/** A premultiplied overlay the size of the output, its top row first like comp. */
const OVERLAY = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uSize;
void main() {
  o = texture(uTex, gl_FragCoord.xy / uSize);
}`;

/**
 * A quad: uCenter, uHalf (half its size) and uAngle (clockwise) in output
 * pixels, grown by a pixel all round so the fragment shader can soften its
 * edges. Output rows run top down, like comp's.
 */
const QUAD_VERT = `#version 300 es
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uAngle;
uniform vec2 uOut;
out vec2 vLocal;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vLocal = corner * (uHalf + 1.0);
  float s = sin(uAngle);
  float c = cos(uAngle);
  vec2 p = uCenter + vec2(vLocal.x * c - vLocal.y * s, vLocal.x * s + vLocal.y * c);
  gl_Position = vec4(p / uOut * 2.0 - 1.0, 0.0, 1.0);
}`;

/** A premultiplied texture over the quad, faded to nothing across its outermost pixel. */
const QUAD = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uHalf;
uniform float uOpacity;
in vec2 vLocal;
void main() {
  vec2 inside = uHalf - abs(vLocal);
  float edge = clamp(min(inside.x, inside.y) + 0.5, 0.0, 1.0);
  vec2 uv = clamp((vLocal + uHalf) / (2.0 * uHalf), 0.0, 1.0);
  o = texture(uTex, uv) * (uOpacity * edge);
}`;

/**
 * A layer's picture made ready for QUAD: premultiplied, the size of the
 * picture, row 0 at the top. uMode 0: a premultiplied image; 1: a video
 * frame without alpha; 2: a stacked video frame, colour in the top
 * uContent of the rows and alpha as luma from uAlphaAt down. Rows are
 * clamped to the colour so linear filtering never reaches the padding or
 * the alpha below. Then the chroma key, the same sums as applyChromaKey in
 * shared/chroma-key.ts.
 */
const PREP = `${HEADER}
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uMode;
uniform float uContent;
uniform float uAlphaAt;
uniform float uTexelY;
uniform float uKeyOn;
uniform vec2 uKey;
uniform vec4 uKeyParams;
const vec3 K = vec3(0.2126, 0.7152, 0.0722);
void main() {
  vec2 f = gl_FragCoord.xy / uSize;
  vec3 c;
  float a;
  if (uMode < 0.5) {
    vec4 t = texture(uTex, f);
    a = t.a;
    c = a > 0.0 ? t.rgb / a : vec3(0.0);
  } else {
    float y = clamp(f.y * uContent, 0.5 * uTexelY, uContent - 0.5 * uTexelY);
    c = texture(uTex, vec2(f.x, y)).rgb;
    a = uMode < 1.5 ? 1.0 : clamp(dot(texture(uTex, vec2(f.x, uAlphaAt + y)).rgb, K), 0.0, 1.0);
  }
  if (uKeyOn > 0.5) {
    float similarity = uKeyParams.x;
    float smoothness = uKeyParams.y;
    float spill = uKeyParams.z;
    float luma = dot(c, K);
    vec2 cbcr = vec2((c.b - luma) / 1.8556, (c.r - luma) / 1.5748);
    float d = length(cbcr - uKey) / sqrt(2.0);
    a *= smoothness > 0.0 ? clamp((d - similarity) / smoothness, 0.0, 1.0) : step(similarity, d);
    float len = length(uKey);
    if (len > 0.0) {
      vec2 dir = uKey / len;
      cbcr -= dir * max(dot(cbcr, dir), 0.0) * spill;
    }
    float r = luma + 1.5748 * cbcr.y;
    float b = luma + 1.8556 * cbcr.x;
    c = clamp(vec3(r, (luma - K.r * r - K.b * b) / K.g, b), 0.0, 1.0);
  }
  o = vec4(c * a, a);
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

type Uniforms = Record<string, WebGLTexture | number[] | number>;

/** A picture for an image layer; its texture is made on first use and kept while the same object comes back. */
export type LayerImage = TexImageSource & { width: number; height: number };

/** A layer picture after PREP, and what it was made from, so it's only redone when that changes. */
interface Prepped {
  target: Target;
  from: WebGLTexture;
  made: string;
}

/** A video layer's latest frame as decoded, before PREP. */
interface LayerFrame {
  tex: WebGLTexture;
  w: number;
  h: number;
  layout: OverlayLayout;
  version: number;
}

const keyText = (key: ChromaKey | null) => (key ? `${key.color}/${key.similarity}/${key.smoothness}/${key.spill}` : '-');

const mipLevels = (w: number, h: number) => Math.floor(Math.log2(Math.max(w, h))) + 1;

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private src: { tex: WebGLTexture; w: number; h: number } | undefined;
  private comp: Target;
  private bgA: Target;
  private bgB: Target;
  private programs: Record<'cover' | 'blur' | 'background' | 'draw' | 'overlay' | 'display' | 'prep', WebGLProgram>;
  /** Made with the first overlay; `version` is the one uploaded. */
  private overlayTex: { tex: WebGLTexture; version: number } | undefined;
  private quadProgram: WebGLProgram;
  /** Image textures by asset id, with the picture each holds. */
  private images = new Map<string, { tex: WebGLTexture; image: LayerImage }>();
  /** Video layers' latest frames, by layer id. */
  private frames = new Map<string, LayerFrame>();
  /** Pictures after PREP (video layers, keyed images), by layer id. */
  private prepped = new Map<string, Prepped>();
  private frameVersion = 0;
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
      overlay: this.program(OVERLAY),
      display: this.program(DISPLAY),
      prep: this.program(PREP),
    };
    this.quadProgram = this.program(QUAD, QUAD_VERT);
    gl.bindVertexArray(gl.createVertexArray());
  }

  /** Size of the last uploaded source frame, or null before the first one. */
  get sourceSize(): Size | null {
    return this.src ? { width: this.src.w, height: this.src.h } : null;
  }

  /**
   * Copies a video layer's decoded frame in, to be drawn wherever the scene
   * puts that layer. The caller can close the frame right after.
   */
  uploadLayerFrame(layerId: string, frame: VideoFrame, layout: OverlayLayout): void {
    const gl = this.gl;
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    let held = this.frames.get(layerId);
    if (!held || held.w !== w || held.h !== h) {
      if (held) gl.deleteTexture(held.tex);
      held = { tex: this.texture(w, h, 1), w, h, layout, version: 0 };
      this.frames.set(layerId, held);
    }
    gl.bindTexture(gl.TEXTURE_2D, held.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    held.layout = layout;
    held.version = ++this.frameVersion;
  }

  /** Forgets the frames of video layers not in `keep` (gone from the clip, or not showing). */
  keepLayerFrames(keep: ReadonlySet<string>): void {
    for (const [id, held] of this.frames) {
      if (keep.has(id)) continue;
      this.gl.deleteTexture(held.tex);
      this.frames.delete(id);
    }
  }

  /**
   * The average colour (RGB 0..255) of a 5×5 patch of a layer's own
   * picture at (u, v), 0..1 from its top left: a video layer's latest frame
   * (by layer id) or an image (by asset id), before any key. Null when
   * neither is here. For the green screen's eyedropper.
   */
  sampleLayer(layerId: string, assetId: string, u: number, v: number): [number, number, number] | null {
    const gl = this.gl;
    const frame = this.frames.get(layerId);
    const image = this.images.get(assetId);
    const source = frame
      ? { tex: frame.tex, w: frame.layout.width, h: frame.layout.height, premultiplied: false }
      : image
        ? { tex: image.tex, w: image.image.width, h: image.image.height, premultiplied: true }
        : null;
    if (!source) return null;
    const x = Math.min(Math.max(Math.round(u * source.w) - 2, 0), Math.max(0, source.w - 5));
    const y = Math.min(Math.max(Math.round(v * source.h) - 2, 0), Math.max(0, source.h - 5));
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, source.tex, 0);
    const px = new Uint8Array(5 * 5 * 4);
    // Texture rows are top first, like comp's, so (x, y) needs no flipping.
    gl.readPixels(x, y, Math.min(5, source.w), Math.min(5, source.h), gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    const sum = [0, 0, 0];
    let weight = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = source.premultiplied ? px[i + 3]! / 255 : 1;
      if (a <= 0) continue;
      for (let c = 0; c < 3; c++) sum[c]! += px[i + c]! / a;
      weight++;
    }
    return weight > 0 ? (sum.map((s) => Math.min(255, s / weight)) as [number, number, number]) : null;
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

  /**
   * Draws one output frame into comp: `ops` in order, the video from the
   * uploaded source, images from `images` by asset id (one not there yet is
   * skipped) and `captions` where the captions go.
   */
  render(ops: readonly SceneOp[], images: ReadonlyMap<string, LayerImage>, captions: Overlay | null): void {
    if (!this.src) return;
    // Textures of pictures the scene no longer has (a deleted or replaced image) go.
    for (const [id, held] of this.images) {
      if (images.has(id)) continue;
      this.gl.deleteTexture(held.tex);
      this.images.delete(id);
    }
    const drawn = new Set(ops.flatMap((op) => (op.type === 'image' || op.type === 'overlay' ? [op.layerId] : [])));
    for (const [id, p] of this.prepped) {
      if (drawn.has(id)) continue;
      this.dropTarget(p.target);
      this.prepped.delete(id);
    }
    for (const op of ops) {
      if (op.type === 'video') {
        this.drawVideo(op.recipe);
      } else if (op.type === 'captions') {
        if (captions) this.drawOverlay(captions);
      } else if (op.type === 'image') {
        const image = images.get(op.assetId);
        // A closed ImageBitmap (let go of after its layer went) is 0×0 and can't be uploaded.
        if (!image || image.width === 0) continue;
        const tex = this.imageTexture(op.assetId, image);
        this.drawQuad(op.key ? this.prep(op.layerId, tex, 'image', image, null, op.key) : tex, op.quad, op.opacity);
      } else {
        // No frame yet (its working file is still being made, or it failed): left out.
        const frame = this.frames.get(op.layerId);
        if (frame) this.drawQuad(this.prep(op.layerId, frame.tex, `frame ${frame.version}`, frame.layout, frame.layout, op.key), op.quad, op.opacity);
      }
    }
  }

  private drawVideo(recipe: FrameRecipe): void {
    const gl = this.gl;
    const src = this.src!;
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

  private imageTexture(assetId: string, image: LayerImage): WebGLTexture {
    const gl = this.gl;
    const held = this.images.get(assetId);
    if (held?.image === image) return held.tex;
    if (held) gl.deleteTexture(held.tex);
    const tex = this.texture(image.width, image.height, mipLevels(image.width, image.height));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Images come decoded premultiplied (render/images.ts); this covers any other source.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    // Images are usually drawn smaller than they are; mipmaps keep that clean.
    gl.generateMipmap(gl.TEXTURE_2D);
    this.images.set(assetId, { tex, image });
    return tex;
  }

  /**
   * The layer's picture through PREP, redone only when its source texture,
   * `version` or the key changed. `layout` null: `tex` is a premultiplied
   * image of `size`; else a video frame laid out as `layout` says.
   */
  private prep(layerId: string, tex: WebGLTexture, version: string, size: Size, layout: OverlayLayout | null, key: ChromaKey | null): WebGLTexture {
    const gl = this.gl;
    const { width: w, height: h } = size;
    const made = `${version}|${keyText(key)}`;
    let p = this.prepped.get(layerId);
    if (p && p.from === tex && p.made === made && p.target.w === w && p.target.h === h) return p.target.tex;
    if (!p || p.target.w !== w || p.target.h !== h) {
      if (p) this.dropTarget(p.target);
      p = { target: this.target(w, h, mipLevels(w, h)), from: tex, made };
      this.prepped.set(layerId, p);
    }
    const [kcb, kcr] = key ? chromaOf(...rgbOf(key.color)) : [0, 0];
    const coded = layout ? layout.codedHeight : h;
    this.pass(this.programs.prep, p.target, {
      uTex: tex,
      uSize: [w, h],
      uMode: !layout ? 0 : layout.alphaAt === null ? 1 : 2,
      uContent: layout ? layout.height / coded : 1,
      uAlphaAt: layout?.alphaAt != null ? layout.alphaAt / coded : 0,
      uTexelY: 1 / coded,
      uKeyOn: key ? 1 : 0,
      uKey: [kcb, kcr],
      uKeyParams: [key?.similarity ?? 0, key?.smoothness ?? 0, key?.spill ?? 0, 0],
    });
    gl.bindTexture(gl.TEXTURE_2D, p.target.tex);
    // Layers are usually drawn smaller than they are; mipmaps keep that clean.
    gl.generateMipmap(gl.TEXTURE_2D);
    p.from = tex;
    p.made = made;
    return p.target.tex;
  }

  private dropTarget(t: Target): void {
    this.gl.deleteFramebuffer(t.fbo);
    this.gl.deleteTexture(t.tex);
  }

  private drawQuad(tex: WebGLTexture, q: Quad, opacity: number): void {
    const gl = this.gl;
    gl.enable(gl.BLEND);
    // As for the captions: colour over, comp stays opaque.
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.use(this.quadProgram, this.comp, {
      uTex: tex,
      uCenter: [q.cx, q.cy],
      uHalf: [q.w / 2, q.h / 2],
      uAngle: q.rotation,
      uOut: [OUTPUT.width, OUTPUT.height],
      uOpacity: opacity,
    });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.BLEND);
  }

  private drawOverlay(overlay: Overlay): void {
    const gl = this.gl;
    if (!this.overlayTex) this.overlayTex = { tex: this.texture(OUTPUT.width, OUTPUT.height, 1, gl.NEAREST), version: -1 };
    const o = this.overlayTex;
    if (o.version !== overlay.version) {
      gl.bindTexture(gl.TEXTURE_2D, o.tex);
      // Premultiplied, so the blend below is the usual "over" without dark fringes.
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, overlay.image);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      o.version = overlay.version;
    }
    gl.enable(gl.BLEND);
    // Colour: over. Alpha: comp stays opaque.
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
    this.pass(this.programs.overlay, this.comp, { uTex: o.tex, uSize: [OUTPUT.width, OUTPUT.height] });
    gl.disable(gl.BLEND);
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
    if (this.overlayTex) gl.deleteTexture(this.overlayTex.tex);
    for (const { tex } of this.images.values()) gl.deleteTexture(tex);
    for (const { tex } of this.frames.values()) gl.deleteTexture(tex);
    for (const { target } of this.prepped.values()) this.dropTarget(target);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p);
    gl.deleteProgram(this.quadProgram);
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
    this.overlayTex = undefined;
    this.images.clear();
    this.frames.clear();
    this.prepped.clear();
    this.packer = undefined;
    this.pbos = [];
  }

  private pass(program: WebGLProgram, target: Target | null, uniforms: Uniforms): void {
    this.use(program, target, uniforms);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  /** Binds `program` and its uniforms, drawing into `target` (the canvas when null). */
  private use(program: WebGLProgram, target: Target | null, uniforms: Uniforms): void {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
    gl.viewport(0, 0, target?.w ?? gl.drawingBufferWidth, target?.h ?? gl.drawingBufferHeight);
    let unit = 0;
    for (const [name, value] of Object.entries(uniforms)) {
      const at = gl.getUniformLocation(program, name);
      if (typeof value === 'number') {
        gl.uniform1f(at, value);
      } else if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2f(at, value[0]!, value[1]!);
        else gl.uniform4f(at, value[0]!, value[1]!, value[2]!, value[3]!);
      } else {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, value);
        gl.uniform1i(at, unit++);
      }
    }
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

  private program(fragment: string, vertex: string = VERT): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
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
