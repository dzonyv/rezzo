import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

const lines = async () => (await readFile(path.join(dir, 'logs', 'rezzo.log'), 'utf8')).trim().split('\n');

describe('log', () => {
  it('writes a line with when, how bad and where from, a longer message indented under it', async () => {
    const { formatLine } = await import('./log.ts');
    expect(formatLine(new Date('2026-11-18T10:00:00Z'), 'warn', 'page', 'one\r\ntwo')).toBe('2026-11-18T10:00:00.000Z warn  [page] one\n    two\n');
    expect(formatLine(new Date(0), 'error', 'x', 'a'.repeat(5000)).length).toBeLessThan(4100);
  });

  it('appends to rezzo.log, and starts over past a megabyte, keeping the last one', async () => {
    const logs = path.join(dir, 'logs');
    await mkdir(logs);
    await writeFile(path.join(logs, 'rezzo.log'), 'x'.repeat(1_000_001));
    const { log } = await import('./log.ts');
    log('error', 'export', 'it failed');
    expect(await readFile(path.join(logs, 'rezzo.log'), 'utf8')).toMatch(/error \[export\] it failed\n$/);
    expect((await stat(path.join(logs, 'rezzo.old.log'))).size).toBe(1_000_001);
    log('info', 'app', 'again');
    expect(await lines()).toHaveLength(2);
  });

  it('writes a line that repeats once, with how many times it came', async () => {
    const { log } = await import('./log.ts');
    for (let i = 0; i < 5; i++) log('warn', 'page', 'same thing');
    log('error', 'export', 'something else');
    const written = await lines();
    expect(written).toHaveLength(3);
    expect(written[1]).toMatch(/info {2}\[log\] the line above came 4 more time\(s\)$/);
    expect(written[2]).toMatch(/error \[export\] something else$/);
  });

  it('leaves out lines past twenty a second, and says how many', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-18T10:00:00.100Z'));
      const { log } = await import('./log.ts');
      for (let i = 0; i < 30; i++) log('warn', 'page', `frame ${i}`);
      vi.setSystemTime(new Date('2026-11-18T10:00:01.100Z'));
      log('warn', 'page', 'later');
      const written = await lines();
      expect(written).toHaveLength(22);
      expect(written[20]).toMatch(/\[log\] 10 line\(s\) left out, too many at once$/);
      expect(written[21]).toMatch(/later$/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps writing when the old file can't be replaced", async () => {
    const logs = path.join(dir, 'logs');
    // A folder with something in it where rezzo.old.log would go: the rename fails.
    await mkdir(path.join(logs, 'rezzo.old.log'), { recursive: true });
    await writeFile(path.join(logs, 'rezzo.old.log', 'x'), 'x');
    await writeFile(path.join(logs, 'rezzo.log'), 'x'.repeat(1_000_001));
    const { log } = await import('./log.ts');
    log('error', 'export', 'first');
    log('error', 'export', 'second');
    expect(await readFile(path.join(logs, 'rezzo.log'), 'utf8')).toMatch(/first\n.*second\n$/);
  });

  it('tells a cancel from a failure', async () => {
    const { isCancel } = await import('./log.ts');
    expect(isCancel(Object.assign(new Error('stopped'), { code: 'cancelled' }))).toBe(true);
    expect(isCancel(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isCancel(new Error('ffmpeg exited with 1'))).toBe(false);
    expect(isCancel(null)).toBe(false);
  });
});
