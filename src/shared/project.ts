/**
 * The project document: what a .rezzo file holds and what undo/redo works on.
 *
 * Times are seconds from the start of the source episode, keyframes
 * included, so trimming a clip never moves its framing relative to the
 * picture. Anything that can be rebuilt from the source (audio for
 * transcription, working files, thumbnails) lives in the cache, not here;
 * the transcript does live here, because it takes minutes to make and
 * Phase 2 lets the user edit it.
 */
import { z } from 'zod';
import { assetSchema, type Asset } from './assets.ts';
import { captionStyleSchema } from './caption-style.ts';
import { chromaKeySchema } from './chroma-key.ts';
import { EFFECT_NAMES, paramsValid } from './effects.ts';
import { fps, frameAt, timeOfFrame, workingFrameRate } from './frames.ts';
import { motionSchema, transformSchema } from './motion.ts';
import { MAX_DUCK_DB, MIN_DUCK_DB } from './ducking.ts';
import { followSchema, MAX_FADE_SECONDS, soundSourceSchema } from './sounds.ts';
import { speakerCountSchema, speakerPickSchema, voiceEditSchema } from './voices.ts';

/** Bumped when the file format changes in a way older files need migrating for. */
export const PROJECT_FORMAT = 15;
export const PROJECT_EXTENSION = 'rezzo';

export const TRANSCRIPT_LANGUAGES = ['sr', 'hr', 'bs'] as const;
export type TranscriptLanguage = (typeof TRANSCRIPT_LANGUAGES)[number];

const seconds = z.number().finite().nonnegative();

export const sourceSchema = z.object({
  /** Absolute path when the source was imported or last relinked. */
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  /** Identifies the file's content (see main/fingerprint.ts); also the cache key. */
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  duration: seconds,
  video: z.object({
    codec: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    /** Nominal frame rate as a fraction, e.g. [30000, 1001]. */
    frameRate: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    /** Frame timing varies; the working file makes it constant. */
    variableFrameRate: z.boolean(),
    /** Colour matrix tag, or null when the file doesn't say. */
    colorSpace: z.string().nullable(),
  }),
  audio: z
    .object({
      codec: z.string(),
      sampleRate: z.number().int().positive(),
      channels: z.number().int().positive(),
    })
    .nullable(),
});
export type Source = z.infer<typeof sourceSchema>;

export const wordSchema = z.object({
  /** Latin script, with punctuation attached as spoken ("fudbal,"). */
  text: z.string().min(1),
  start: seconds,
  end: seconds,
  /** Whisper's confidence, 0..1 (lowest token probability in the word). */
  p: z.number().min(0).max(1),
  /** A new caption page starts at this word (set by the user). */
  pageBreak: z.literal(true).optional(),
});
export type Word = z.infer<typeof wordSchema>;

export const segmentSchema = z.object({
  start: seconds,
  end: seconds,
  words: z.array(wordSchema),
});
export type Segment = z.infer<typeof segmentSchema>;

/**
 * Seconds added to every DTW word start, which turbo places late. Measured
 * against hand-placed labels in spikes/REPORT.md (Phase 2 checks).
 */
export const DTW_START_SHIFT = -0.1;

export const transcriptSchema = z.object({
  language: z.enum(TRANSCRIPT_LANGUAGES),
  /** Model id from tools.json, e.g. "large-v3-turbo-q5_0". */
  model: z.string(),
  createdAt: z.iso.datetime(),
  /** The DTW_START_SHIFT applied when the transcript was made. */
  startShift: z.number(),
  segments: z.array(segmentSchema),
});
export type Transcript = z.infer<typeof transcriptSchema>;

interface RawTranscript {
  startShift?: number;
  segments: { start: number; words: { start: number; end: number }[] }[];
}

/**
 * Brings a transcript made before word starts were corrected (it has no
 * startShift) up to date by shifting every start, as transcription now
 * does. Anything else comes back as it is, for the schema to judge.
 */
export function upgradeTranscript(raw: unknown): unknown {
  const t = raw as RawTranscript | null;
  if (typeof t !== 'object' || t === null || t.startShift !== undefined || !Array.isArray(t.segments)) return raw;
  const segments = t.segments.map((s) => {
    const words = s.words.map((w) => {
      const start = Math.max(0, Math.round((w.start + DTW_START_SHIFT) * 1000) / 1000);
      return { ...w, start, end: Math.max(start, w.end) };
    });
    return { ...s, start: words[0]?.start ?? s.start, words };
  });
  return { ...t, startShift: DTW_START_SHIFT, segments };
}

/**
 * Clips made before word starts were corrected start the usual lead before
 * their first word's old, late start, which is now exactly where that word
 * starts. Moving their start back by the same shift gives the lead back.
 * Framing needs no change: before its first keyframe a value holds that
 * keyframe's value.
 */
function clipsWithLead(old: Record<string, unknown>): unknown {
  const source = old.source as Pick<Source, 'video'> | null;
  if (!source?.video || !Array.isArray(old.clips)) return old.clips;
  const rate = workingFrameRate(source);
  const lead = Math.round(-DTW_START_SHIFT * fps(rate));
  return (old.clips as { start: number; end: number }[]).map((clip) => {
    const start = timeOfFrame(Math.max(0, frameAt(clip.start, rate) - lead), rate);
    return clip.end - start <= MAX_CLIP_SECONDS + 1e-6 ? { ...clip, start } : clip;
  });
}

/** Longest clip; its working file is loaded into memory whole. */
export const MAX_CLIP_SECONDS = 180;
/** How far in a crop can zoom: 1 is the largest crop that fits the frame. */
export const MAX_ZOOM = 4;

/**
 * How a keyframe leads to the next one: "cut" holds its value until the
 * next keyframe (like a camera cut), "smooth" eases over to it.
 */
export const EASES = ['cut', 'smooth'] as const;
export type Ease = (typeof EASES)[number];

export interface Key<T> {
  t: number;
  value: T;
  ease: Ease;
}

/** A value over time: one keyframe means it never changes. Sorted by time. */
export type Animated<T> = Key<T>[];

function animated<T extends z.ZodType>(value: T) {
  return z
    .array(z.object({ t: seconds, value, ease: z.enum(EASES) }))
    .min(1)
    .refine((keys) => keys.every((k, i) => i === 0 || keys[i - 1]!.t < k.t), 'keyframes must be in time order');
}

/** Follow: one crop of the speaker. Split: two crops stacked. Full: the whole frame over a blurred copy. */
export const LAYOUTS = ['follow', 'split', 'full'] as const;
export type Layout = (typeof LAYOUTS)[number];

const unit = z.number().min(0).max(1);
const zoom = z.number().min(1).max(MAX_ZOOM);

/** Centre of the crop in the source (0..1 across and down) and its zoom. */
export const cropSchema = z.object({ x: unit, y: unit, zoom });
export type Crop = z.infer<typeof cropSchema>;

/** The whole frame, scaled to the output width times `zoom`; `y` slides it from the top (-1) to the bottom (1). */
export const fullFrameSchema = z.object({ y: z.number().min(-1).max(1), zoom });
export type FullFrame = z.infer<typeof fullFrameSchema>;

/**
 * The source video in the clip. Each layout keeps its own framing, so
 * switching to Split and back leaves the Follow crop as it was.
 */
export const videoLayerSchema = z.object({
  id: z.uuid(),
  kind: z.literal('video'),
  layout: animated(z.enum(LAYOUTS)),
  follow: animated(cropSchema),
  splitTop: animated(cropSchema),
  splitBottom: animated(cropSchema),
  full: animated(fullFrameSchema),
});
export type VideoLayer = z.infer<typeof videoLayerSchema>;

/**
 * The clip's captions: the transcript's words in the clip, drawn in
 * `style`. `y` is the middle of the caption block, 0 at the top of the
 * output and 1 at the bottom; it has keyframes like the framing. Split has
 * its own track, `splitY`, as it has its own crops: a place that suits two
 * people stacked doesn't suit one, and the other way round.
 */
export const captionLayerSchema = z.object({
  id: z.uuid(),
  kind: z.literal('caption'),
  style: captionStyleSchema,
  y: animated(unit),
  splitY: animated(unit),
});
export type CaptionLayer = z.infer<typeof captionLayerSchema>;

/**
 * An image over the picture from `start` to `end` (source seconds). Its
 * transform has keyframes like the framing; `motion` adds preset
 * animations on top (shared/motion.ts).
 */
export const imageLayerSchema = z.object({
  id: z.uuid(),
  kind: z.literal('image'),
  /** One of the project's assets. */
  assetId: z.uuid(),
  start: seconds,
  end: seconds,
  transform: animated(transformSchema),
  motion: motionSchema,
  /** Green screen, or null for none. */
  key: chromaKeySchema.nullable(),
});
export type ImageLayer = z.infer<typeof imageLayerSchema>;

/**
 * A video over the picture, placed and animated like an image. It plays
 * from `offset` seconds into the file at the layer's `start`; past the
 * file's end it starts over when `loop` is on, otherwise its last frame
 * stays up (shared/scene.ts, overlayTimeAt).
 */
export const overlayLayerSchema = imageLayerSchema.extend({
  kind: z.literal('overlay'),
  offset: seconds,
  /** Loudness of the file's own sound in the mix, 0..1. */
  volume: z.number().min(0).max(1),
  loop: z.boolean(),
});
export type OverlayLayer = z.infer<typeof overlayLayerSchema>;

/** Slowest and fastest a Lottie animation can play, as a factor of its own speed. */
export const MIN_LOTTIE_SPEED = 0.1;
export const MAX_LOTTIE_SPEED = 4;

/**
 * A Lottie animation over the picture, placed and animated like an image.
 * It plays from its first frame at the layer's `start`, `speed` times as
 * fast as it was made; past its end it starts over when `loop` is on,
 * otherwise its last frame stays up (shared/lottie.ts, lottieFrameAt).
 */
export const lottieLayerSchema = imageLayerSchema.omit({ key: true }).extend({
  kind: z.literal('lottie'),
  speed: z.number().min(MIN_LOTTIE_SPEED).max(MAX_LOTTIE_SPEED),
  loop: z.boolean(),
});
export type LottieLayer = z.infer<typeof lottieLayerSchema>;

/**
 * An effect from the library (shared/effects.ts) from `start` to `end`. It
 * changes everything drawn under it, as much as `intensity` (0..1, with
 * keyframes) says; `params` are the effect's own settings.
 */
export const effectLayerSchema = z.object({
  id: z.uuid(),
  kind: z.literal('effect'),
  effect: z.enum(EFFECT_NAMES),
  start: seconds,
  end: seconds,
  intensity: animated(unit),
  params: z.record(z.string(), z.number().finite()),
});
export type EffectLayer = z.infer<typeof effectLayerSchema>;

const fade = z.number().min(0).max(MAX_FADE_SECONDS);

/**
 * A sound from `start` to `end` (source seconds): an effect from the
 * library or a file of the user's own. Like a video layer's sound it plays
 * from `offset` seconds into the file, starts over at the end when `loop`
 * is on and stops otherwise, and goes on through the clip's skips. It
 * fades in over `fadeIn` seconds and out over `fadeOut` before it stops
 * (shared/sound-mix.ts). It draws nothing, so where it is in `layers`
 * doesn't matter; new ones go at the end. A file of the user's own can
 * have its loudness evened out (shared/loudness.ts); the library's sounds
 * already are. A sound can go with another layer's entrance or exit
 * (`follows`): then its time comes from that layer (shared/follow-sounds.ts),
 * it doesn't loop, and it goes when that layer is deleted. Music is
 * usually turned down while someone talks (`duck`).
 */
export const soundLayerSchema = z.object({
  id: z.uuid(),
  kind: z.literal('sound'),
  sound: soundSourceSchema,
  start: seconds,
  end: seconds,
  offset: seconds,
  /** Loudness in the mix, 0..1. */
  volume: unit,
  fadeIn: fade,
  fadeOut: fade,
  loop: z.boolean(),
  /** Its file is turned up or down to the loudness speech is evened out to; only for a file of the user's own. */
  evenLoudness: z.boolean(),
  /** The layer whose entrance or exit it goes with, or null for a sound placed on its own. */
  follows: followSchema.nullable(),
  /** Whether it's turned down while someone talks, and by how many dB (shared/ducking.ts). */
  duck: z.object({ on: z.boolean(), db: z.number().min(MIN_DUCK_DB).max(MAX_DUCK_DB) }),
});
export type SoundLayer = z.infer<typeof soundLayerSchema>;

/**
 * Everything in a clip is a layer, drawn in the order of `layers`: the
 * source video first, then the rest over it. Sound layers draw nothing.
 */
export const layerSchema = z.discriminatedUnion('kind', [
  videoLayerSchema, captionLayerSchema, imageLayerSchema, overlayLayerSchema, lottieLayerSchema, effectLayerSchema, soundLayerSchema,
]);
export type Layer = z.infer<typeof layerSchema>;
/** Layers that show a file, placed and animated over the picture. */
export type PlacedLayer = ImageLayer | OverlayLayer | LottieLayer;
/** Layers that play for part of the clip and can be moved around in it. */
export type TimedLayer = PlacedLayer | EffectLayer | SoundLayer;

export const isPlaced = (layer: Layer): layer is PlacedLayer => layer.kind === 'image' || layer.kind === 'overlay' || layer.kind === 'lottie';
export const isTimed = (layer: Layer): layer is TimedLayer => isPlaced(layer) || layer.kind === 'effect' || layer.kind === 'sound';
export const isSound = (layer: Layer): layer is SoundLayer => layer.kind === 'sound';

const NO_KEYS: Animated<unknown> = [];

/** The keyframes a layer's keyframe controls work on: a placed layer's transform, an effect's intensity; a sound has none. */
export const keyframesOf = (layer: TimedLayer): Animated<unknown> =>
  layer.kind === 'effect' ? layer.intensity : layer.kind === 'sound' ? NO_KEYS : layer.transform;

/** The project's sound file a sound layer plays, or null for a sound from the library. */
export const soundAssetId = (layer: SoundLayer): string | null => ('assetId' in layer.sound ? layer.sound.assetId : null);

/** The kind of asset each placed layer shows. */
export const ASSET_KIND_OF = { image: 'image', overlay: 'video', lottie: 'lottie' } as const satisfies Record<PlacedLayer['kind'], Asset['kind']>;

export const clipSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    start: seconds,
    end: seconds,
    /** Stretches of the source that don't play (shared/skips.ts): in order, apart, on whole frames. */
    skips: z.array(z.object({ start: seconds, end: seconds })),
    /** The clip's own sound is turned up or down to one loudness (shared/loudness.ts). */
    evenLoudness: z.boolean(),
    layers: z.array(layerSchema).min(1),
  })
  .refine((c) => c.end > c.start, 'a clip ends after it starts')
  .refine((c) => c.skips.every((s, i) => s.end > s.start && (i === 0 || s.start >= c.skips[i - 1]!.end)), 'skips are in order and apart')
  .refine((c) => c.layers[0]?.kind === 'video' && c.layers.filter((l) => l.kind === 'video').length === 1, 'a clip has one video layer, at the bottom')
  .refine((c) => c.layers.filter((l) => l.kind === 'caption').length <= 1, 'a clip has at most one caption layer')
  .refine((c) => c.layers.every((l) => !isTimed(l) || l.end > l.start), 'a layer ends after it starts')
  .refine((c) => c.layers.every((l) => l.kind !== 'effect' || paramsValid(l.effect, l.params)), "an effect has its own settings, each in range")
  .refine(followsValid, 'a sound goes with the entrance or exit of a layer in its clip that shows a file, and only one sound with each')
  .refine((c) => c.end - c.start <= MAX_CLIP_SECONDS + 1e-6, `a clip is at most ${MAX_CLIP_SECONDS} s long`);
export type Clip = z.infer<typeof clipSchema>;

/** Every sound that goes with a layer goes with one that shows a file, and no two with the same part of it. */
function followsValid(clip: { layers: readonly Layer[] }): boolean {
  const placed = new Set(clip.layers.filter(isPlaced).map((l) => l.id));
  const taken = new Set<string>();
  for (const l of clip.layers) {
    if (l.kind !== 'sound' || !l.follows) continue;
    const part = `${l.follows.layerId} ${l.follows.part}`;
    if (!placed.has(l.follows.layerId) || taken.has(part)) return false;
    taken.add(part);
  }
  return true;
}

/** The clip's source video layer; every clip has one. */
export function videoLayerOf(clip: Clip): VideoLayer {
  const layer = clip.layers.find((l) => l.kind === 'video');
  if (!layer) throw new Error(`clip ${clip.id} has no video layer`);
  return layer;
}

/** The clip's captions, or null when it has none. */
export function captionLayerOf(clip: Clip): CaptionLayer | null {
  return clip.layers.find((l) => l.kind === 'caption') ?? null;
}

/** The clip's layers that show for part of it, bottom first. */
export const timedLayers = (clip: Clip): TimedLayer[] => clip.layers.filter(isTimed);

/** The ids of the project's files a clip's layers show or play. */
export const layerAssetIds = (clip: Pick<Clip, 'layers'>): string[] =>
  clip.layers.flatMap((l) => {
    if (isPlaced(l)) return [l.assetId];
    const sound = isSound(l) ? soundAssetId(l) : null;
    return sound === null ? [] : [sound];
  });

/** The clip's sound layers, in the order they were added. */
export const soundLayers = (clip: Pick<Clip, 'layers'>): SoundLayer[] => clip.layers.filter(isSound);

/** The clip's layers that show a file, bottom first. */
export const placedLayers = (clip: Pick<Clip, 'layers'>): PlacedLayer[] => clip.layers.filter(isPlaced);

export const projectSchema = z
  .object({
    format: z.literal(PROJECT_FORMAT),
    id: z.uuid(),
    name: z.string(),
    source: sourceSchema.nullable(),
    transcript: transcriptSchema.nullable(),
    clips: z.array(clipSchema),
    /** Files the clips' layers show; each layer names one by id. */
    assets: z.array(assetSchema),
    /** Telling the episode's voices apart. */
    voices: z.object({
      /** How many people talk, or 'auto' to find out from the audio. */
      count: speakerCountSchema,
      /** The user's corrections to the voices, oldest first. */
      edits: z.array(voiceEditSchema),
      /** Who the user said was talking, across all clips: one click teaches the whole episode. */
      picks: z.array(speakerPickSchema),
    }),
  })
  .refine((p) => new Set(p.assets.map((a) => a.id)).size === p.assets.length, 'asset ids are unique')
  .refine((p) => {
    const kinds = new Map(p.assets.map((a) => [a.id, a.kind]));
    return p.clips.every((c) =>
      c.layers.every((l) => {
        if (isPlaced(l)) return kinds.get(l.assetId) === ASSET_KIND_OF[l.kind];
        const sound = isSound(l) ? soundAssetId(l) : null;
        return sound === null || kinds.get(sound) === 'audio';
      }),
    );
  }, "every layer uses one of the project's assets, of the right kind");
export type Project = z.infer<typeof projectSchema>;

export function newProject(name: string, id: string = crypto.randomUUID()): Project {
  return { format: PROJECT_FORMAT, id, name, source: null, transcript: null, clips: [], assets: [], voices: { count: 'auto', edits: [], picks: [] } };
}

/** The asset with this id, or undefined. */
export const assetOf = (project: Pick<Project, 'assets'>, id: string): Asset | undefined => project.assets.find((a) => a.id === id);

/** Older formats, each upgraded one step at a time. */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  // Format 2 added clips.
  1: (old) => ({ ...old, clips: [] }),
  // Format 3 corrected the late DTW word starts.
  2: (old) => ({ ...old, transcript: upgradeTranscript(old.transcript), clips: clipsWithLead(old) }),
  // Format 4 added captions. Nothing to change; the new number keeps older
  // versions of the app from opening a file they would drop the captions from.
  3: (old) => old,
  // Format 5 added layers over the picture, and the files they show.
  4: (old) => ({ ...old, assets: [] }),
  // Format 6 added video layers, and green screen on images.
  5: (old) => ({ ...old, clips: imagesWithoutKey(old.clips) }),
  // Format 7 added Lottie animations and effects. Nothing to change.
  6: (old) => old,
  // Format 8 added the number of people talking, for telling voices apart.
  7: (old) => ({ ...old, voices: { count: 'auto' } }),
  // Format 9 added corrections to the voices and clicks on who is talking.
  8: (old) => ({ ...old, voices: { ...(old.voices as object), edits: [], picks: [] } }),
  // Format 10 added stretches a clip leaves out.
  9: (old) => ({ ...old, clips: Array.isArray(old.clips) ? old.clips.map((c: object) => ({ ...c, skips: [] })) : old.clips }),
  // Format 11 gave Split its own place for captions.
  10: (old) => ({ ...old, clips: captionsWithSplit(old.clips) }),
  // Format 12 added sound layers and sound files. Nothing to change.
  11: (old) => old,
  // Format 13 added evening out loudness. Clips and sounds made before it
  // keep sounding as they did.
  12: (old) => ({ ...old, clips: Array.isArray(old.clips) ? old.clips.map(withoutEvenLoudness) : old.clips }),
  // Format 14 let a sound go with a layer's entrance or exit. Sounds made
  // before it stand on their own.
  13: (old) => ({ ...old, clips: patchSounds(old.clips, { follows: null }) }),
  // Format 15 let a sound be turned down while someone talks. Sounds made
  // before it keep sounding as they did. 12 dB: DEFAULT_DUCK_DB when this was written.
  14: (old) => ({ ...old, clips: patchSounds(old.clips, { duck: { on: false, db: 12 } }) }),
};

/**
 * Captions still at the old default go on the line between the halves, off
 * the lower face. Captions someone placed keep that place in Split too.
 * Numbers rather than today's defaults: these files won't change.
 */
function captionsWithSplit(clips: unknown): unknown {
  if (!Array.isArray(clips)) return clips;
  const splitY = (y: Key<number>[]) => (y.length === 1 && y[0]!.value === 0.7 ? [{ ...y[0]!, value: 0.5 }] : y);
  return clips.map((clip: { layers?: unknown }) =>
    Array.isArray(clip?.layers)
      ? { ...clip, layers: clip.layers.map((l: { kind?: unknown; y?: Key<number>[] }) => (l?.kind === 'caption' && Array.isArray(l.y) ? { ...l, splitY: splitY(l.y) } : l)) }
      : clip,
  );
}

function imagesWithoutKey(clips: unknown): unknown {
  if (!Array.isArray(clips)) return clips;
  return clips.map((clip: { layers?: unknown }) =>
    Array.isArray(clip?.layers)
      ? { ...clip, layers: clip.layers.map((l: { kind?: unknown }) => (l?.kind === 'image' ? { ...l, key: null } : l)) }
      : clip,
  );
}

/** A clip from before format 13, and its sound layers, with evening out off. */
function withoutEvenLoudness(clip: { layers?: unknown }): unknown {
  if (typeof clip !== 'object' || clip === null) return clip;
  const layers = Array.isArray(clip.layers) ? clip.layers.map((l: { kind?: unknown }) => (l?.kind === 'sound' ? { ...l, evenLoudness: false } : l)) : clip.layers;
  return { ...clip, evenLoudness: false, layers };
}

/** `clips` with `patch` over each of their sound layers. */
function patchSounds(clips: unknown, patch: object): unknown {
  if (!Array.isArray(clips)) return clips;
  return clips.map((clip: { layers?: unknown }) =>
    Array.isArray(clip?.layers)
      ? { ...clip, layers: clip.layers.map((l: { kind?: unknown }) => (l?.kind === 'sound' ? { ...l, ...patch } : l)) }
      : clip,
  );
}

export class ProjectFormatError extends Error {
  readonly code: 'not-json' | 'not-a-project' | 'too-new' | 'invalid';

  constructor(code: ProjectFormatError['code'], detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

/** Parses the text of a .rezzo file, upgrading older formats. */
export function parseProject(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProjectFormatError('not-json');
  }
  if (typeof data !== 'object' || data === null || typeof (data as { format?: unknown }).format !== 'number') {
    throw new ProjectFormatError('not-a-project');
  }
  let doc = data as Record<string, unknown> & { format: number };
  if (doc.format > PROJECT_FORMAT) throw new ProjectFormatError('too-new', String(doc.format));
  while (doc.format < PROJECT_FORMAT) {
    const migrate = MIGRATIONS[doc.format];
    if (!migrate) throw new ProjectFormatError('invalid', `no migration from format ${doc.format}`);
    doc = { ...migrate(doc), format: doc.format + 1 };
  }
  const result = projectSchema.safeParse(doc);
  if (!result.success) throw new ProjectFormatError('invalid', z.prettifyError(result.error));
  return result.data;
}

export function serializeProject(project: Project): string {
  return `${JSON.stringify(projectSchema.parse(project), null, 2)}\n`;
}
