/**
 * Installs a tool from tools.json into its own folder: download (resuming a
 * partial download), check size and SHA-256, unpack, and leave an
 * ".installed" marker. The marker names the checksum, so a tool whose
 * pinned version changes gets installed again.
 *
 * Node only; used by the app's media worker and by scripts/fetch-tools.mts.
 */
import { spawn } from 'node:child_process';
import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Tool } from './manifest.ts';

export interface DownloadProgress {
  received: number;
  total: number;
}

const MARKER = '.installed';

export async function isInstalled(tool: Tool, dir: string): Promise<boolean> {
  try {
    return JSON.parse(await readFile(path.join(dir, MARKER), 'utf8')).sha256 === tool.sha256;
  } catch {
    return false;
  }
}

export class DownloadError extends Error {
  readonly code: 'network' | 'http' | 'checksum' | 'extract';

  constructor(code: DownloadError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export async function install(
  tool: Tool,
  dir: string,
  options: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal } = {},
): Promise<void> {
  if (await isInstalled(tool, dir)) return;
  await mkdir(dir, { recursive: true });
  await rm(path.join(dir, MARKER), { force: true });

  const fileName = path.basename(new URL(tool.url).pathname);
  const file = path.join(dir, fileName);
  const part = `${file}.part`;

  const sha256 = await download(tool, part, options);
  if (sha256 !== tool.sha256) {
    await rm(part, { force: true });
    throw new DownloadError('checksum', `${tool.id}: checksum mismatch, the download was damaged`);
  }
  await rename(part, file);

  if (tool.extract) {
    try {
      await unzip(file, dir);
    } catch (e) {
      throw new DownloadError('extract', `${tool.id}: ${String(e)}`);
    }
    await rm(file, { force: true });
  }
  await writeFile(path.join(dir, MARKER), JSON.stringify({ id: tool.id, sha256: tool.sha256 }));
}

/** Downloads into `part`, continuing an earlier partial download. Returns the SHA-256 of the whole file. */
async function download(
  tool: Tool,
  part: string,
  { onProgress, signal }: { onProgress?: (p: DownloadProgress) => void; signal?: AbortSignal },
): Promise<string> {
  const hash = createHash('sha256');
  let have = await sizeOf(part);
  if (have > tool.size) {
    await rm(part, { force: true });
    have = 0;
  }
  if (have > 0) await hashFile(part, hash);
  if (have === tool.size) return hash.digest('hex');

  let res: Response;
  try {
    res = await fetch(tool.url, { redirect: 'follow', signal, headers: have > 0 ? { Range: `bytes=${have}-` } : {} });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new DownloadError('network', `${tool.id}: ${String(e)}`);
  }
  if (have > 0 && res.status === 200) {
    // The server ignored the range; start over.
    await res.body?.cancel();
    await rm(part, { force: true });
    return download(tool, part, { onProgress, signal });
  }
  if (!res.ok || !res.body) throw new DownloadError('http', `${tool.id}: HTTP ${res.status}`);

  let received = have;
  let reported = 0;
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    received += chunk.length;
    if (received - reported >= 1 << 20 || received === tool.size) {
      reported = received;
      onProgress?.({ received, total: tool.size });
    }
  });
  try {
    await pipeline(body, createWriteStream(part, { flags: have > 0 ? 'a' : 'w' }), { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new DownloadError('network', `${tool.id}: ${String(e)}`);
  }
  return hash.digest('hex');
}

async function hashFile(file: string, hash: Hash): Promise<void> {
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
}

async function sizeOf(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

/** Windows' own bsdtar unpacks .zip; Git Bash's GNU tar would not. */
function unzip(archive: string, into: string): Promise<void> {
  const tar = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
  return new Promise((resolve, reject) => {
    const child = spawn(tar, ['-xf', archive, '-C', into], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited with ${code}: ${stderr}`))));
  });
}
