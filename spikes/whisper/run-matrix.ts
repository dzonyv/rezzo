/**
 * Transcribes every clip with every model and language setting.
 *
 *   node whisper/run-matrix.ts [--models a,b] [--langs sr,hr] [--clips id,id] [--prompt]
 *
 * Output per run: <media>/whisper/runs/<clip>/<model>__<lang>[__prompt].json
 * (whisper.cpp's full JSON) and a .meta.json with wall time and the detected
 * language. Runs that already have output are skipped, so it can be resumed.
 *
 * DTW word alignment needs flash attention off; speed with flash attention on
 * is measured separately by bench-speed.ts.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { modelsDir, vendorDir } from '../shared/paths.ts';
import { ffmpegExe, run } from '../shared/tools.ts';
import { audioPath, listClips, runsDir, type Clip } from './clips.ts';

export const MODELS: Record<string, { file: string; dtw: string }> = {
  'large-v3-turbo': { file: 'ggml-large-v3-turbo.bin', dtw: 'large.v3.turbo' },
  'large-v3-turbo-q5_0': { file: 'ggml-large-v3-turbo-q5_0.bin', dtw: 'large.v3.turbo' },
  'large-v3': { file: 'ggml-large-v3.bin', dtw: 'large.v3' },
  'large-v3-q5_0': { file: 'ggml-large-v3-q5_0.bin', dtw: 'large.v3' },
  medium: { file: 'ggml-medium.bin', dtw: 'medium' },
  'medium-q5_0': { file: 'ggml-medium-q5_0.bin', dtw: 'medium' },
};

export const LANGS = ['sr', 'hr', 'bs', 'auto'];

/**
 * Latin text that contains č, ć, š, ž and đ but no words whose spelling
 * differs between ekavian and ijekavian, so it nudges the script without
 * nudging the dialect.
 */
export const PROMPT = 'Dobrodošli. Danas ćemo pričati o sportu, životu i svemu što se dešava, a među gostima je i jedan đak.';

export const whisperCli = path.join(vendorDir, 'whisper', 'Release', 'whisper-cli.exe');

export async function extractAudio(clip: Clip): Promise<string> {
  const wav = audioPath(clip);
  if (!existsSync(wav)) {
    await mkdir(path.dirname(wav), { recursive: true });
    await run(ffmpegExe(), ['-v', 'error', '-y', '-i', clip.file, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  }
  return wav;
}

async function transcribe(clip: Clip, wav: string, model: string, lang: string, prompt: boolean) {
  const dir = runsDir(clip);
  const name = `${model}__${lang}${prompt ? '__prompt' : ''}`;
  const base = path.join(dir, name);
  if (existsSync(`${base}.json`)) return;
  await mkdir(dir, { recursive: true });

  const args = [
    '-m', path.join(modelsDir, 'whisper', MODELS[model].file),
    '-f', wav, '-l', lang, '-t', '8', '-np',
    '-ojf', '-of', base,
    '-dtw', MODELS[model].dtw, '-nfa',
    ...(prompt ? ['--prompt', PROMPT] : []),
  ];
  const t0 = performance.now();
  const { stderr } = await run(whisperCli, args);
  const wallMs = performance.now() - t0;
  const detected = stderr.match(/auto-detected language: (\w+) \(p = ([\d.]+)\)/);

  await writeFile(`${base}.meta.json`, JSON.stringify({
    clip: clip.id, model, lang, prompt, wallMs: Math.round(wallMs),
    detectedLanguage: detected ? { lang: detected[1], p: Number(detected[2]) } : undefined,
  }, null, 2));
  console.log(`${clip.id} ${name}: ${(wallMs / 1000).toFixed(1)} s${detected ? ` (detected ${detected[1]})` : ''}`);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      models: { type: 'string' },
      langs: { type: 'string' },
      clips: { type: 'string' },
      prompt: { type: 'boolean', default: false },
    },
  });
  const models = values.models?.split(',') ?? Object.keys(MODELS);
  const langs = values.langs?.split(',') ?? LANGS;
  const clips = listClips().filter((c) => !values.clips || values.clips.split(',').includes(c.id));

  for (const clip of clips) {
    const wav = await extractAudio(clip);
    for (const model of models) {
      for (const lang of langs) await transcribe(clip, wav, model, lang, values.prompt);
    }
  }
}
