/**
 * How long it takes to turn a 1080p overlay with alpha into a stacked
 * working file (1920×2176), and where the time goes: decoding the input,
 * the filter graph, or the encoder. Run layers/formats.ts first.
 *
 *   node layers/convert-speed.ts
 */
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ffmpegExe, run } from '../shared/tools.ts';
import { layersDir, REF_SECONDS, round, stackedFilter } from './common.ts';

const inputs = [
  { id: 'webm-vp9', args: ['-c:v', 'libvpx-vp9', '-i', 'vp9.webm'] },
  { id: 'webm-vp9, 8 decoder threads', args: ['-threads', '8', '-c:v', 'libvpx-vp9', '-i', 'vp9.webm'] },
  { id: 'prores-4444', args: ['-i', 'prores4444.mov'] },
  { id: 'hevc-alpha', args: ['-i', 'hevc-alpha.mp4'] },
];

const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', '15', '-bf', '0', 'out.mp4'];
const NVENC = ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '18', '-b:v', '0', '-g', '15', '-bf', '0', 'out.mp4'];
const NULL = ['-f', 'null', '-'];

const outputs = [
  { id: 'decode only', args: ['-map', '0:v:0', ...NULL] },
  { id: 'RGBA filters', filter: 'rgba', args: NULL },
  { id: 'RGBA + x264', filter: 'rgba', args: X264 },
  { id: 'YUV filters', filter: 'planar', args: NULL },
  { id: 'YUV + x264', filter: 'planar', args: X264 },
  { id: 'YUV + NVENC', filter: 'planar', args: NVENC },
] as const;

const formats = path.join(layersDir, 'formats');
const filters = {
  rgba: stackedFilter({ premultiply: false, halfHeight: 1088 }),
  planar: stackedFilter({ premultiply: false, planar: true, halfHeight: 1088 }),
};
const rows: Record<string, unknown>[] = [];
for (const input of inputs) {
  const row: Record<string, unknown> = { input: input.id };
  for (const out of outputs) {
    const args = input.args.map((a) => (a.includes('.') ? path.join(formats, a) : a));
    const tail = out.args.map((a) => (a === 'out.mp4' ? path.join(layersDir, 'convert-speed.mp4') : a));
    const t0 = performance.now();
    await run(ffmpegExe(), ['-y', '-v', 'error', ...args, ...('filter' in out ? ['-filter_complex', filters[out.filter], '-map', '[v]'] : []), ...tail]);
    row[out.id] = round(REF_SECONDS / ((performance.now() - t0) / 1000), 1);
  }
  rows.push(row);
  console.log(JSON.stringify(row));
}
await rm(path.join(layersDir, 'convert-speed.mp4'), { force: true });
await writeFile(path.join(layersDir, 'convert-speed.json'), JSON.stringify(rows, null, 2));

console.log(`\n| Input | ${outputs.map((o) => o.id).join(' | ')} |`);
console.log(`|---|${outputs.map(() => '---').join('|')}|`);
for (const r of rows) console.log(`| ${r.input} | ${outputs.map((o) => `${r[o.id]}×`).join(' | ')} |`);
