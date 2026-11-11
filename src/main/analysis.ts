/**
 * The clip analysis runs in the page (MediaPipe needs WebGL); the main
 * process hands it the models and keeps its results next to the working
 * file they were made from, so opening the clip again doesn't redo them.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { analysisFileOf, clipAnalysisSchema, type ClipAnalysis } from '../shared/analysis.ts';
import { writeFileAtomic } from '../node/files.ts';
import { tool } from '../node/tools/manifest.ts';
import { allowedFileOf, allowMedia } from './media-protocol.ts';
import { bundledToolDir, cacheDir } from './paths.ts';

const modelFile = (id: string) => path.join(bundledToolDir(id), path.basename(new URL(tool(id).url).pathname));

/** URLs the page can fetch MediaPipe's models from. */
export function analysisModels(): { pose: string; face: string } {
  return { pose: allowMedia(modelFile('pose-landmarker-full')), face: allowMedia(modelFile('face-landmarker')) };
}

/**
 * Only working files the page was handed, which live in the cache; the
 * result sits beside it. (The page is also handed the source and the layers'
 * files, which are the user's and must not get anything written next to them.)
 */
function resultFile(workingUrl: unknown): string {
  const file = typeof workingUrl === 'string' ? allowedFileOf(workingUrl) : null;
  const inCache = (f: string) => {
    const rel = path.relative(cacheDir(), f);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  if (!file || !inCache(file) || path.extname(file).toLowerCase() !== '.mp4') throw new Error('Not a working file');
  return analysisFileOf(file);
}

export async function loadAnalysis(workingUrl: unknown): Promise<ClipAnalysis | null> {
  try {
    return clipAnalysisSchema.parse(JSON.parse(await readFile(resultFile(workingUrl), 'utf8')));
  } catch {
    return null;
  }
}

export async function saveAnalysis(workingUrl: unknown, analysis: unknown): Promise<void> {
  const file = resultFile(workingUrl);
  // A working file deleted with the cache (main/storage.ts) while it was analysed: its result has no place to go.
  await stat(allowedFileOf(workingUrl as string)!);
  await writeFileAtomic(file, JSON.stringify(clipAnalysisSchema.parse(analysis)));
}
