/**
 * Downloads the binaries and models listed in tools.json, verifies size and
 * checksum, and unpacks archives.
 *
 *   node scripts/fetch-tools.ts                    # everything
 *   node scripts/fetch-tools.ts ffmpeg whisper     # by group
 *   node scripts/fetch-tools.ts large-v3-turbo     # by id
 *
 * Files that already exist with the right size are skipped. For items without
 * a published checksum the computed SHA-256 is printed so it can be pinned.
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { repoRoot } from '../shared/paths.ts';

interface Item {
  id: string;
  group: string;
  name: string;
  url: string;
  size: number;
  sha256?: string;
  md5Base64?: string;
  dest: string;
  extract?: boolean;
}

const manifestPath = path.join(import.meta.dirname, '..', 'tools.json');
const { items } = JSON.parse(await readFile(manifestPath, 'utf8')) as { items: Item[] };

const filters = process.argv.slice(2);
const selected = filters.length === 0
  ? items
  : items.filter((it) => filters.includes(it.id) || filters.includes(it.group));

if (selected.length === 0) {
  console.error(`Nothing matches: ${filters.join(', ')}`);
  process.exit(1);
}

const totalMb = selected.reduce((sum, it) => sum + it.size, 0) / 1e6;
console.log(`${selected.length} item(s), ${totalMb.toFixed(0)} MB in total.\n`);

for (const item of selected) {
  await fetchItem(item);
}

async function fetchItem(item: Item): Promise<void> {
  const destDir = path.join(repoRoot, item.dest);
  const fileName = path.basename(new URL(item.url).pathname);
  const filePath = path.join(destDir, fileName);
  await mkdir(destDir, { recursive: true });

  if ((await sizeOf(filePath)) === item.size) {
    console.log(`= ${item.name}: already downloaded`);
    return;
  }

  console.log(`↓ ${item.name}`);
  const res = await fetch(item.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${item.id}: HTTP ${res.status}`);

  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  let received = 0;
  let lastReport = 0;
  const partPath = `${filePath}.part`;

  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    sha256.update(chunk);
    md5.update(chunk);
    received += chunk.length;
    if (received - lastReport > 50e6) {
      lastReport = received;
      process.stdout.write(`  ${(received / 1e6).toFixed(0)} / ${(item.size / 1e6).toFixed(0)} MB\r`);
    }
  });
  await pipeline(body, createWriteStream(partPath));

  const sha256Hex = sha256.digest('hex');
  const problems: string[] = [];
  if (received !== item.size) problems.push(`size ${received}, expected ${item.size}`);
  if (item.sha256 && item.sha256 !== sha256Hex) problems.push(`sha256 ${sha256Hex}, expected ${item.sha256}`);
  if (item.md5Base64 && item.md5Base64 !== md5.digest('base64')) problems.push('md5 mismatch');
  if (problems.length > 0) {
    await rm(partPath, { force: true });
    throw new Error(`${item.id}: verification failed (${problems.join('; ')})`);
  }

  await rename(partPath, filePath);
  const verifiedBy = item.sha256 ? 'sha256' : item.md5Base64 ? 'md5' : 'size only';
  console.log(`  ok (${verifiedBy})${item.sha256 ? '' : `, sha256 ${sha256Hex}`}`);

  if (item.extract) {
    await run(tarExe(), ['-xf', filePath, '-C', destDir]);
    console.log(`  extracted into ${path.relative(repoRoot, destDir)}`);
  }
}

async function sizeOf(file: string): Promise<number | undefined> {
  try {
    return (await stat(file)).size;
  } catch {
    return undefined;
  }
}

/** Windows' own bsdtar can unpack .zip; Git Bash's GNU tar cannot. */
function tarExe(): string {
  return process.platform === 'win32'
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}
