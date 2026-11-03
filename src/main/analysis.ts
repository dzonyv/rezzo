/**
 * The clip analysis runs in the page (MediaPipe needs WebGL); the main
 * process hands it the models and keeps its results next to the working
 * file they were made from, so opening the clip again doesn't redo them.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ANALYSIS_VERSION, clipAnalysisSchema, type ClipAnalysis } from '../shared/analysis.ts';
import { writeFileAtomic } from '../node/files.ts';
import { tool } from '../node/tools/manifest.ts';
import { allowedFileOf, allowMedia } from './media-protocol.ts';
import { bundledToolDir } from './paths.ts';

const modelFile = (id: string) => path.join(bundledToolDir(id), path.basename(new URL(tool(id).url).pathname));

/** URLs the page can fetch MediaPipe's models from. */
export function analysisModels(): { pose: string; face: string } {
  return { pose: allowMedia(modelFile('pose-landmarker-full')), face: allowMedia(modelFile('face-landmarker')) };
}

/** Only working files the page was handed; the result sits beside it. */
function resultFile(workingUrl: unknown): string {
  const file = typeof workingUrl === 'string' ? allowedFileOf(workingUrl) : null;
  if (!file || path.extname(file).toLowerCase() !== '.mp4') throw new Error('Not a working file');
  return `${file}.analysis.v${ANALYSIS_VERSION}.json`;
}

export async function loadAnalysis(workingUrl: unknown): Promise<ClipAnalysis | null> {
  try {
    return clipAnalysisSchema.parse(JSON.parse(await readFile(resultFile(workingUrl), 'utf8')));
  } catch {
    return null;
  }
}

export async function saveAnalysis(workingUrl: unknown, analysis: unknown): Promise<void> {
  await writeFileAtomic(resultFile(workingUrl), JSON.stringify(clipAnalysisSchema.parse(analysis)));
}
