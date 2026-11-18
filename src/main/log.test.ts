import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let dir: string;
vi.mock('electron', () => ({ app: { getPath: () => dir }, shell: {} }));

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-log-'));
  vi.resetModules();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('log', () => {
  it('writes a line with when, how bad and where from, a longer message indented under it', async () => {
    const { formatLine } = await import('./log.ts');
    expect(formatLine(new Date('2026-11-18T10:00:00Z'), 'warn', 'page', 'one\r\ntwo')).toBe('2026-11-18T10:00:00.000Z warn  [page] one\n    two\n');
    expect(formatLine(new Date(0), 'error', 'x', 'a'.repeat(5000)).length).toBeLessThan(4100);
  });

  it('appends to rezzo.log, and starts over past a megabyte, keeping the last one', async () => {
    const logs = path.join(dir, 'logs');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(logs);
    await writeFile(path.join(logs, 'rezzo.log'), 'x'.repeat(1_000_001));
    const { log } = await import('./log.ts');
    log('error', 'export', 'it failed');
    expect(await readFile(path.join(logs, 'rezzo.log'), 'utf8')).toMatch(/error \[export\] it failed\n$/);
    expect((await stat(path.join(logs, 'rezzo.old.log'))).size).toBe(1_000_001);
    log('info', 'app', 'again');
    expect((await readFile(path.join(logs, 'rezzo.log'), 'utf8')).split('\n')).toHaveLength(3);
  });
});
