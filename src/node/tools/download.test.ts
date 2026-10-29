import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DownloadError, install, isInstalled } from './download.ts';
import type { Tool } from './manifest.ts';

const content = Buffer.alloc(3 << 20, 7).map((_, i) => i % 251);
const sha256 = createHash('sha256').update(content).digest('hex');

let server: Server;
let base: string;
let dir: string;
let requests: { range?: string }[] = [];
let honourRanges = true;

beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({ range: req.headers.range });
    const m = honourRanges ? /^bytes=(\d+)-$/.exec(req.headers.range ?? '') : null;
    if (m) {
      const from = Number(m[1]);
      res.writeHead(206, { 'Content-Length': content.length - from });
      res.end(content.subarray(from));
    } else {
      res.writeHead(req.url === '/missing.bin' ? 404 : 200, { 'Content-Length': content.length });
      res.end(content);
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-dl-'));
  requests = [];
  honourRanges = true;
  return () => rm(dir, { recursive: true, force: true });
});

const tool = (over: Partial<Tool> = {}): Tool => ({
  id: 'model',
  kind: 'download',
  name: 'Test model',
  url: `${base}/model.bin`,
  size: content.length,
  sha256,
  license: 'CC0',
  source: base,
  ...over,
});

describe('install', () => {
  it('downloads, verifies and marks the tool installed', async () => {
    const progress: number[] = [];
    await install(tool(), dir, { onProgress: (p) => progress.push(p.received) });
    expect((await readFile(path.join(dir, 'model.bin'))).equals(content)).toBe(true);
    expect(await isInstalled(tool(), dir)).toBe(true);
    expect(progress.at(-1)).toBe(content.length);
  });

  it('does nothing when already installed', async () => {
    await install(tool(), dir);
    requests = [];
    await install(tool(), dir);
    expect(requests).toHaveLength(0);
  });

  it('continues a partial download', async () => {
    await writeFile(path.join(dir, 'model.bin.part'), content.subarray(0, 1 << 20));
    await install(tool(), dir);
    expect(requests).toEqual([{ range: `bytes=${1 << 20}-` }]);
    expect((await readFile(path.join(dir, 'model.bin'))).equals(content)).toBe(true);
  });

  it('starts over when the server ignores the range', async () => {
    honourRanges = false;
    await writeFile(path.join(dir, 'model.bin.part'), content.subarray(0, 1 << 20));
    await install(tool(), dir);
    expect((await readFile(path.join(dir, 'model.bin'))).equals(content)).toBe(true);
  });

  it('rejects a damaged download and keeps nothing', async () => {
    const err = await install(tool({ sha256: 'f'.repeat(64) }), dir).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadError);
    expect(err.code).toBe('checksum');
    await expect(readFile(path.join(dir, 'model.bin.part'))).rejects.toThrow();
  });

  it('reports HTTP errors', async () => {
    const err = await install(tool({ url: `${base}/missing.bin` }), dir).catch((e) => e);
    expect(err.code).toBe('http');
  });

  it('reuses a complete download instead of fetching it again', async () => {
    await writeFile(path.join(dir, 'model.bin'), content);
    await install(tool(), dir);
    expect(requests).toHaveLength(0);
    expect(await isInstalled(tool(), dir)).toBe(true);
  });

  it('reinstalls when the pinned checksum changes', async () => {
    await install(tool(), dir);
    expect(await isInstalled(tool({ sha256: 'e'.repeat(64) }), dir)).toBe(false);
  });
});
