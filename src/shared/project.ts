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
import { fps, frameAt, timeOfFrame, workingFrameRate } from './frames.ts';

/** Bumped when the file format changes in a way older files need migrating for. */
export const PROJECT_FORMAT = 3;
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

/** Everything in a clip is a layer; Phase 3 adds images, effects and more. */
export const layerSchema = z.discriminatedUnion('kind', [videoLayerSchema]);
export type Layer = z.infer<typeof layerSchema>;

export const clipSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    start: seconds,
    end: seconds,
    layers: z.array(layerSchema).min(1),
  })
  .refine((c) => c.end > c.start, 'a clip ends after it starts')
  .refine((c) => c.end - c.start <= MAX_CLIP_SECONDS + 1e-6, `a clip is at most ${MAX_CLIP_SECONDS} s long`);
export type Clip = z.infer<typeof clipSchema>;

/** The clip's source video layer; every clip has one. */
export function videoLayerOf(clip: Clip): VideoLayer {
  const layer = clip.layers.find((l) => l.kind === 'video');
  if (!layer) throw new Error(`clip ${clip.id} has no video layer`);
  return layer;
}

export const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  id: z.uuid(),
  name: z.string(),
  source: sourceSchema.nullable(),
  transcript: transcriptSchema.nullable(),
  clips: z.array(clipSchema),
});
export type Project = z.infer<typeof projectSchema>;

export function newProject(name: string, id: string = crypto.randomUUID()): Project {
  return { format: PROJECT_FORMAT, id, name, source: null, transcript: null, clips: [] };
}

/** Older formats, each upgraded one step at a time. */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {
  // Format 2 added clips.
  1: (old) => ({ ...old, clips: [] }),
  // Format 3 corrected the late DTW word starts.
  2: (old) => ({ ...old, transcript: upgradeTranscript(old.transcript), clips: clipsWithLead(old) }),
};

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
