/**
 * The people for a cover's cutout (shared/cutout.ts): looked for once in
 * the source frame at a moment, in the part of it the framing shows, and
 * kept, so redrawing or a small framing change doesn't look again. What's
 * found is kept for every renderer drawing the same working file, so
 * saving the cover or exporting it uses what the preview found. The scene
 * renderer calls update() as it draws; what's found is handed to the
 * compositor, which draws the cutout with it.
 */
import { covers, maskRegion, maskSize } from '../../../shared/cutout.ts';
import type { FrameRecipe, Rect } from '../../../shared/framing.ts';
import { findPeople, type PeopleMask } from '../cutout/segment.ts';
import type { Compositor } from './compositor.ts';

/** How many masks are kept: a few moments to go back to while picking the cover's. */
const KEEP = 8;
/**
 * A mask found in a wider region is used for a narrower one only up to
 * this many times its area: the segmenter looks at 256×256 whatever it's
 * given, so a mask of the whole frame is too coarse for a close crop.
 */
const WIDER = 1.5;

interface Found {
  file: string;
  key: string;
  time: number;
  rect: Rect;
  mask: PeopleMask;
}

/** Masks found, newest last, by every renderer. */
let found: Found[] = [];

const area = (r: Rect) => r.w * r.h;

export type FindPeople = (pixels: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) => Promise<PeopleMask>;

export class CutoutMasks {
  /** Something was found: a paused preview draws again. */
  onFound?: () => void;
  /** Looking failed; it isn't tried again for that picture. Said once until something is found again. */
  onError?: (e: unknown) => void;
  /** Looking started or stopped. */
  onLooking?: (looking: boolean) => void;
  /** The working file the frames come from; masks are shared by it. Until it's set, nothing is shared. */
  file: string = crypto.randomUUID();
  /** What finds the people: MediaPipe's segmenter; the end-to-end tests put a stand-in here. */
  find: FindPeople;

  private readonly compositor: Compositor;
  private looking = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  /** A failure was reported and nothing was found since. */
  private told = false;

  constructor(compositor: Compositor, find: FindPeople = findPeople) {
    this.compositor = compositor;
    this.find = find;
  }

  /**
   * Hands the compositor the people at source time `t` (the frame it has
   * now) for the part of it `recipe` shows, or nothing until they're found;
   * starts looking if nobody looked there yet.
   */
  update(t: number, recipe: FrameRecipe): void {
    const source = this.compositor.sourceSize;
    if (!source || recipe.draws.length === 0) return;
    const region = maskRegion(recipe.draws.map((d) => d.src));
    const file = this.file;
    const hit = found.findLast((f) => f.file === file && f.time === t && covers(f.rect, region) && area(f.rect) <= area(region) * WIDER);
    if (hit) {
      if (this.compositor.cutoutKey !== hit.key) this.compositor.setCutoutMask({ key: hit.key, data: hit.mask.data, w: hit.mask.width, h: hit.mask.height, rect: hit.rect });
      return;
    }
    // People found in another frame are in the wrong place here.
    this.compositor.setCutoutMask(null);
    const key = `${file}@${t}:${region.x},${region.y},${region.w},${region.h}`;
    if (this.looking.has(key) || this.failed.has(key)) return;
    const size = maskSize(region, source);
    const pixels = this.compositor.readSource(region, size.width, size.height);
    if (!pixels) return;
    const job = this.find(pixels, size.width, size.height).then(
      (mask) => {
        found = [...found, { file, key, time: t, rect: region, mask }].slice(-KEEP);
        this.told = false;
      },
      (e: unknown) => {
        this.failed.add(key);
        throw e;
      },
    );
    this.looking.set(key, job);
    if (this.looking.size === 1) this.onLooking?.(true);
    job
      .then(
        () => this.onFound?.(),
        (e: unknown) => {
          if (this.told) return;
          this.told = true;
          this.onError?.(e);
        },
      )
      .finally(() => {
        this.looking.delete(key);
        if (this.looking.size === 0) this.onLooking?.(false);
      });
  }

  /** Waits for what's being looked for; resolves true if anything was, and rejects if it failed. */
  async settle(): Promise<boolean> {
    if (this.looking.size === 0) return false;
    await Promise.all(this.looking.values());
    return true;
  }
}
