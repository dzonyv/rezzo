/**
 * Installs a tool from tools.json into its own folder: download (resuming a
 * partial download), check size and SHA-256, unpack, and leave an
 * ".installed" marker. The marker names the checksum, so a tool whose
 * pinned version changes gets installed again, and the files that were
 * installed, so a tool that lost one (antivirus does this) is too.
 *
 * Node only; used by the app's media worker and by scripts/fetch-tools.mts.
 */
import { spawn } from 'node:child_process';
import { createHash, type Hash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Tool } from './manifest.ts';

export interface DownloadProgress {
  received: number;
  total: number;
}

const MARKER = '.installed';

const fileNameOf = (tool: Tool): string => path.basename(new URL(tool.url).pathname);

/** Every file under `dir` except the marker, with its size; paths relative to `dir`. */
async function installedFiles(dir: string): Promise<{ path: string; size: number }[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
  return Promise.all(files.filter((f) => f !== MARKER).map(async (f) => ({ path: f, size: (await stat(path.join(dir, f))).size })));
}

/**
 * Whether the tool is in `dir`, whole: the marker is for this version and
 * every file it lists is still there at its size. A marker from before
 * files were listed counts if the folder still holds what it should: the
 * downloaded file at its size, or an unpacked tool's entry file (anything
 * at all for a tool that names none).
 */
export async function isInstalled(tool: Tool, dir: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(path.join(dir, MARKER), 'utf8')) as { sha256?: unknown; files?: { path: string; size: number }[] };
    if (marker.sha256 !== tool.sha256) return false;
    if (marker.files) {
      const sizes = await Promise.all(marker.files.map((f) => sizeOf(path.join(dir, f.path))));
      return marker.files.length > 0 && marker.files.every((f, i) => sizes[i] === f.size);
    }
    if (!tool.extract) return (await sizeOf(path.join(dir, fileNameOf(tool)))) === tool.size;
    const left = await installedFiles(dir);
    const entry = tool.entry?.toLowerCase();
    return entry ? left.some((f) => path.basename(f.path).toLowerCase() === entry) : left.length > 0;
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

/** A download that gets nothing for this long has stalled: it fails, and the next try continues where it stopped. */
const STALL_MS = 60_000;

interface DownloadOptions {
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
  /** STALL_MS, shorter in tests. */
  stallMs?: number;
}

export async function install(tool: Tool, dir: string, options: DownloadOptions = {}): Promise<void> {
  if (await isInstalled(tool, dir)) return;
  await mkdir(dir, { recursive: true });
  await rm(path.join(dir, MARKER), { force: true });

  const file = path.join(dir, fileNameOf(tool));
  const part = `${file}.part`;

  // An earlier attempt may have finished the download and failed to unpack.
  if (!(await isComplete(tool, file))) {
    const sha256 = await download(tool, part, options);
    if (sha256 !== tool.sha256) {
      await rm(part, { force: true });
      throw new DownloadError('checksum', `${tool.id}: checksum mismatch, the download was damaged`);
    }
    await rename(part, file);
  }

  if (tool.extract) {
    try {
      await unzip(file, dir);
    } catch (e) {
      throw new DownloadError('extract', `${tool.id}: ${String(e)}`);
    }
    await rm(file, { force: true });
  }
  await writeFile(path.join(dir, MARKER), JSON.stringify({ id: tool.id, sha256: tool.sha256, files: await installedFiles(dir) }));
}

/** Downloads into `part`, continuing an earlier partial download. Returns the SHA-256 of the whole file. */
async function download(tool: Tool, part: string, options: DownloadOptions): Promise<string> {
  const { onProgress, signal, stallMs = STALL_MS } = options;
  const hash = createHash('sha256');
  let have = await sizeOf(part);
  if (have > tool.size) {
    await rm(part, { force: true });
    have = 0;
  }
  if (have > 0) await hashFile(part, hash);
  if (have === tool.size) return hash.digest('hex');

  // Stopped when nothing arrives for stallMs, while waiting for the answer or between pieces of it.
  const stalled = new AbortController();
  let timer = setTimeout(() => stalled.abort(), stallMs);
  const heard = () => {
    clearTimeout(timer);
    timer = setTimeout(() => stalled.abort(), stallMs);
  };
  const stopped = signal ? AbortSignal.any([signal, stalled.signal]) : stalled.signal;
  try {
    const res = await fetch(tool.url, { redirect: 'follow', signal: stopped, headers: have > 0 ? { Range: `bytes=${have}-` } : {} });
    heard();
    if (have > 0 && res.status === 200) {
      // The server ignored the range; start over.
      await res.body?.cancel();
      await rm(part, { force: true });
      clearTimeout(timer);
      return download(tool, part, options);
    }
    if (!res.ok || !res.body) throw new DownloadError('http', `${tool.id}: HTTP ${res.status}`);

    let received = have;
    let reported = 0;
    const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
    body.on('data', (chunk: Buffer) => {
      heard();
      hash.update(chunk);
      received += chunk.length;
      // More than the file is: not what was asked for, and no reason to fill the disk finding out.
      if (received > tool.size) {
        body.destroy(new DownloadError('checksum', `${tool.id}: the download is larger than it should be`));
        return;
      }
      if (received - reported >= 1 << 20 || received === tool.size) {
        reported = received;
        onProgress?.({ received, total: tool.size });
      }
    });
    await pipeline(body, createWriteStream(part, { flags: have > 0 ? 'a' : 'w' }), { signal: stopped });
  } catch (e) {
    if (signal?.aborted) throw e;
    // Too large: none of it is worth keeping. Stalled or cut off: what came stays, and the next try continues it.
    if (e instanceof DownloadError) {
      if (e.code === 'checksum') await rm(part, { force: true });
      throw e;
    }
    if (stalled.signal.aborted) throw new DownloadError('network', `${tool.id}: nothing arrived for ${Math.round(stallMs / 1000)} s`);
    throw new DownloadError('network', `${tool.id}: ${String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  return hash.digest('hex');
}

async function isComplete(tool: Tool, file: string): Promise<boolean> {
  if ((await sizeOf(file)) !== tool.size) return false;
  const hash = createHash('sha256');
  await hashFile(file, hash);
  return hash.digest('hex') === tool.sha256;
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
