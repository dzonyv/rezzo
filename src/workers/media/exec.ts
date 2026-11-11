import { spawn } from 'node:child_process';
import path from 'node:path';

/** Folder with ffmpeg.exe and ffprobe.exe; the main process passes it in the environment. */
function ffmpegDir(): string {
  const dir = process.env['REZZO_FFMPEG_DIR'];
  if (!dir) throw new Error('REZZO_FFMPEG_DIR is not set');
  return dir;
}

export const ffmpegExe = (): string => path.join(ffmpegDir(), 'ffmpeg.exe');
export const ffprobeExe = (): string => path.join(ffmpegDir(), 'ffprobe.exe');

export class ExecError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(cmd: string, exitCode: number | null, stderr: string) {
    super(`${path.basename(cmd)} exited with ${exitCode}: ${stderr.trim().split('\n').slice(-5).join('\n')}`);
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Runs a program to completion and returns its output. Rejects with
 * ExecError on a non-zero exit; aborting the signal kills the program, and
 * the rejection comes once it has gone.
 * `onStderrLine` sees stderr line by line as it arrives (progress output).
 */
export function exec(
  cmd: string,
  args: string[],
  options: { signal?: AbortSignal; onStderrLine?: (line: string) => void; cwd?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      signal: options.signal,
      cwd: options.cwd,
    });
    let stdout = '';
    let stderr = '';
    let partial = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => {
      stderr += d;
      if (!options.onStderrLine) return;
      const lines = (partial + d).split(/\r\n|\r|\n/);
      partial = lines.pop() ?? '';
      for (const line of lines) options.onStderrLine(line);
    });
    // A program that was stopped (the signal) reports the error first and goes a moment later. Callers
    // delete what it was reading or writing next, which Windows refuses while it's still there.
    let failure: Error | undefined;
    child.on('error', (e) => {
      if (child.pid === undefined) reject(e);
      else failure = e;
    });
    child.on('close', (code) => {
      if (failure) reject(failure);
      else if (code === 0) resolve({ stdout, stderr });
      else reject(new ExecError(cmd, code, stderr));
    });
  });
}
