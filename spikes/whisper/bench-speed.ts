/**
 * Transcription speed per model on the GTX 1660.
 *
 *   node whisper/bench-speed.ts
 *
 * Joins the audio of all clips into one file (a few minutes, closer to a real
 * episode than a single clip) and transcribes it with every model twice:
 * flash attention on (fastest, no DTW) and flash attention off with DTW
 * (what word alignment costs). Run it while nothing else uses the GPU.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { modelsDir } from '../shared/paths.ts';
import { ffmpegExe, run } from '../shared/tools.ts';
import { audioPath, listClips, whisperDir } from './clips.ts';
import { extractAudio, MODELS, whisperCli } from './run-matrix.ts';

const clips = listClips();
for (const clip of clips) await extractAudio(clip);

const joined = path.join(whisperDir, 'audio', '_all-clips.wav');
const list = clips.map((c) => `file '${audioPath(c).replace(/\\/g, '/')}'`).join('\n');
const listFile = path.join(whisperDir, 'audio', '_all-clips.txt');
await writeFile(listFile, list);
await run(ffmpegExe(), ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', joined]);
const { stdout } = await run(path.join(path.dirname(ffmpegExe()), 'ffprobe.exe'), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', joined]);
const audioSeconds = Number(stdout.trim());
console.log(`audio: ${audioSeconds.toFixed(1)} s`);

const results = [];
for (const [model, { file, dtw }] of Object.entries(MODELS)) {
  for (const mode of ['fa', 'dtw'] as const) {
    const args = ['-m', path.join(modelsDir, 'whisper', file), '-f', joined, '-l', 'sr', '-t', '8', '-np', '-nt'];
    if (mode === 'dtw') args.push('-dtw', dtw, '-nfa');
    const t0 = performance.now();
    await run(whisperCli, args);
    const wallSeconds = (performance.now() - t0) / 1000;
    const r = {
      model,
      mode,
      wallSeconds: +wallSeconds.toFixed(1),
      realtimeFactor: +(audioSeconds / wallSeconds).toFixed(1),
      minutesPerHour: +((60 * wallSeconds) / audioSeconds).toFixed(1),
    };
    results.push(r);
    console.log(JSON.stringify(r));
  }
}

await writeFile(path.join(whisperDir, 'speed.json'), JSON.stringify({ audioSeconds, results }, null, 2));
