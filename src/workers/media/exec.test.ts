import { describe, expect, it } from 'vitest';
import { exec } from './exec.ts';

describe('exec', () => {
  it('returns what the program wrote', async () => {
    const { stdout } = await exec(process.execPath, ['-e', 'console.log("ok")']);
    expect(stdout.trim()).toBe('ok');
  });

  it('rejects an aborted run only once the program has gone, so its files can be deleted', async () => {
    const abort = new AbortController();
    let pid = 0;
    const run = exec(process.execPath, ['-e', 'console.error(process.pid); setInterval(() => {}, 1000)'], {
      signal: abort.signal,
      onStderrLine: (line) => {
        pid = Number(line);
        abort.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(pid).toBeGreaterThan(0);
    // Signal 0 only asks whether the process is there.
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it('rejects when the program cannot be started', async () => {
    await expect(exec('no-such-program-rezzo', [])).rejects.toThrow();
  });
});
