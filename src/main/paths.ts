/** Where the app keeps things on disk. */
import { app } from 'electron';
import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Large, machine-local data: downloaded tools and models, the cache.
 * %LOCALAPPDATA%\Rezzo on Windows rather than the roaming profile, which
 * shouldn't carry gigabytes. Tests point it elsewhere with REZZO_LOCAL_DATA.
 */
export function localDataDir(): string {
  const override = process.env['REZZO_LOCAL_DATA'];
  if (override) return override;
  const base = process.env['LOCALAPPDATA'];
  return base ? path.join(base, 'Rezzo') : path.join(app.getPath('userData'), 'local');
}

export const cacheDir = (): string => path.join(localDataDir(), 'cache');

/** Tools downloaded by the app (whisper.cpp, models), one folder per tools.json id. */
export const downloadedToolDir = (id: string): string => path.join(localDataDir(), 'tools', id);

/** Tools that ship with the app: vendor/tools in development, resources/tools when installed. */
export function bundledToolDir(id: string): string {
  // In development the built main process is out/main/index.js, two levels below the repo.
  const root = app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, '..', '..', 'vendor', 'tools');
  return path.join(root, id);
}

/** FFmpeg's bin folder. The zip unpacks into one folder named after the build. */
export function ffmpegBinDir(): string {
  const root = bundledToolDir('ffmpeg');
  let build: string | undefined;
  try {
    build = readdirSync(root, { withFileTypes: true }).find((d) => d.isDirectory())?.name;
  } catch {
    // reported below
  }
  if (!build) throw new Error(`FFmpeg not found in ${root}. Run \`npm run fetch-tools\`.`);
  return path.join(root, build, 'bin');
}
