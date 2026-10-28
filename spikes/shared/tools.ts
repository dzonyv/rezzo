import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { vendorDir } from './paths.ts';

function ffmpegBinDir(): string {
  const root = path.join(vendorDir, 'ffmpeg');
  const build = readdirSync(root, { withFileTypes: true }).find((d) => d.isDirectory());
  if (!build) throw new Error(`No FFmpeg build in ${root}. Run \`npm run fetch-tools -- ffmpeg\`.`);
  return path.join(root, build.name, 'bin');
}

export const ffmpegExe = (): string => path.join(ffmpegBinDir(), 'ffmpeg.exe');
export const ffprobeExe = (): string => path.join(ffmpegBinDir(), 'ffprobe.exe');

/** Runs a command to completion; rejects with the tail of stderr on failure. */
export function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${path.basename(cmd)} exited with ${code}\n${stderr.slice(-2000)}`)),
    );
  });
}
