/**
 * The project document: what a .rezzo file holds and what undo/redo works on.
 *
 * Times are seconds from the start of the source episode. Anything that can
 * be rebuilt from the source (audio for transcription, working files,
 * thumbnails) lives in the cache, not here; the transcript does live here,
 * because it takes minutes to make and Phase 2 lets the user edit it.
 */
import { z } from 'zod';

/** Bumped when the file format changes in a way older files need migrating for. */
export const PROJECT_FORMAT = 1;
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

export const transcriptSchema = z.object({
  language: z.enum(TRANSCRIPT_LANGUAGES),
  /** Model id from tools.json, e.g. "large-v3-turbo-q5_0". */
  model: z.string(),
  createdAt: z.iso.datetime(),
  segments: z.array(segmentSchema),
});
export type Transcript = z.infer<typeof transcriptSchema>;

export const projectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  id: z.uuid(),
  name: z.string(),
  source: sourceSchema.nullable(),
  transcript: transcriptSchema.nullable(),
});
export type Project = z.infer<typeof projectSchema>;

export function newProject(name: string, id: string = crypto.randomUUID()): Project {
  return { format: PROJECT_FORMAT, id, name, source: null, transcript: null };
}

/** Older formats, each upgraded one step at a time. Empty until format 2 exists. */
const MIGRATIONS: Record<number, (old: Record<string, unknown>) => Record<string, unknown>> = {};

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
