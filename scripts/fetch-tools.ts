/**
 * Development setup: installs the tools from tools.json that ship with the
 * app (FFmpeg) into vendor/tools/. Named tools that the app normally
 * downloads itself (whisper.cpp, the model) can be fetched ahead of time;
 * they go where the app looks for them, %LOCALAPPDATA%\Rezzo\tools.
 *
 *   node scripts/fetch-tools.ts                                  # bundled tools
 *   node scripts/fetch-tools.ts whisper-cuda large-v3-turbo-q5_0
 */
import path from 'node:path';
import { install } from '../src/node/tools/download.ts';
import { TOOLS } from '../src/node/tools/manifest.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const ids = process.argv.slice(2);
const selected = ids.length > 0 ? TOOLS.filter((t) => ids.includes(t.id)) : TOOLS.filter((t) => t.kind === 'bundled');

const unknown = ids.filter((id) => !TOOLS.some((t) => t.id === id));
if (unknown.length > 0) {
  console.error(`Not in tools.json: ${unknown.join(', ')}`);
  process.exit(1);
}

function destination(id: string, kind: string): string {
  if (kind === 'bundled') return path.join(repoRoot, 'vendor', 'tools', id);
  const local = process.env['REZZO_LOCAL_DATA'] ?? path.join(process.env['LOCALAPPDATA'] ?? '', 'Rezzo');
  return path.join(local, 'tools', id);
}

for (const tool of selected) {
  const dir = destination(tool.id, tool.kind);
  process.stdout.write(`${tool.name}\n  -> ${dir}\n`);
  let last = 0;
  await install(tool, dir, {
    onProgress: ({ received, total }) => {
      if (received - last < 25e6 && received !== total) return;
      last = received;
      process.stdout.write(`  ${(received / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB\n`);
    },
  });
  process.stdout.write('  ok\n');
}
