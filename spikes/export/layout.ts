/**
 * Geometry shared by the source generator, the Electron lab and the verifier.
 *
 * The synthetic source carries its own frame number as a strip of 16
 * black/white blocks along the top edge. The lab renders the "full frame over
 * blurred background" layout and adds a second strip at the bottom with the
 * renderer's own output frame number. Reading both strips back from the
 * exported file tells us which source frame ended up in which output frame.
 */

export const FPS = 30;

export const SRC_W = 1920;
export const SRC_H = 1080;
export const SRC_SECONDS = 60;
export const SRC_FRAMES = SRC_SECONDS * FPS;

export const OUT_W = 1080;
export const OUT_H = 1920;

/** The exported range: starts 5 s into the source so offsets get exercised. */
export const START_FRAME = 5 * FPS;
export const FRAME_COUNT = 50 * FPS;

/** Output frames saved as uncompressed references for preview-vs-export comparison. */
export const SAMPLE_FRAMES = [0, 1, 299, 750, FRAME_COUNT - 1];

export const BITS = 16;

/** Source frame-number strip: top rows of the source, 120 px per bit. */
export const SRC_BITS_ROWS = 48;
export const SRC_BIT_W = SRC_W / BITS;

/** One-frame white square every second, in sync with a 1 kHz beep. */
export const FLASH = { x: 1700, y: 860, size: 200 };
export const BEEP_SECONDS = 0.05;

/** Foreground: the whole source scaled to the output width, centred vertically. */
export const FG_SCALE = OUT_W / SRC_W;
export const FG_RECT = {
  x: 0,
  y: (OUT_H - SRC_H * FG_SCALE) / 2,
  w: OUT_W,
  h: SRC_H * FG_SCALE,
};

/** Renderer frame-number strip at the bottom of the output. */
export const OUT_BITS_Y0 = OUT_H - 48;
export const OUT_BIT_W = OUT_W / BITS;

/** Where to sample each strip and the flash in an output frame (pixel centres). */
export const PROBE = {
  srcBitsRow: Math.round(FG_RECT.y + (SRC_BITS_ROWS / 2) * FG_SCALE),
  outBitsRow: OUT_BITS_Y0 + 24,
  bitX: (b: number) => Math.round((b + 0.5) * OUT_BIT_W),
  flash: {
    x: Math.round((FLASH.x + FLASH.size / 2) * FG_SCALE),
    y: Math.round(FG_RECT.y + (FLASH.y + FLASH.size / 2) * FG_SCALE),
  },
};

/** Decodes a 16-bit strip from luma samples (one per bit, 0..255). */
export function readBits(lumaAt: (bit: number) => number): number {
  let value = 0;
  for (let b = 0; b < BITS; b++) {
    if (lumaAt(b) > 128) value |= 1 << b;
  }
  return value;
}
