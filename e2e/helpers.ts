/** Shared setup for the end-to-end tests. */
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

const run = promisify(execFile);

function ffmpegExe(): string {
  const root = path.resolve('vendor/tools/ffmpeg');
  const build = readdirSync(root, { withFileTypes: true }).find((d) => d.isDirectory());
  if (!build) throw new Error('FFmpeg missing: run `npm run fetch-tools`');
  return path.join(root, build.name, 'bin', 'ffmpeg.exe');
}

/**
 * A short synthetic video (test pattern and a tone), so the tests need no
 * real footage. `audioOnly` makes an .m4a with no picture.
 */
export async function makeTestVideo(file: string, { seconds = 3, audioOnly = false } = {}): Promise<string> {
  const picture = audioOnly ? [] : ['-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=${seconds}`];
  await run(ffmpegExe(), [
    '-y', '-v', 'error',
    ...picture,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    ...(audioOnly ? [] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
    '-c:a', 'aac', '-shortest', file,
  ]);
  return file;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
}

/** Starts the built app with its own profile and local data folders under `dir`. */
export async function launchApp(dir: string): Promise<Launched> {
  const app = await electron.launch({
    args: [path.resolve('out/main/index.js')],
    env: {
      ...process.env,
      REZZO_USER_DATA: path.join(dir, 'profile'),
      REZZO_LOCAL_DATA: path.join(dir, 'local'),
      ELECTRON_RENDERER_URL: '',
    },
  });
  const page = await app.firstWindow();
  await page.locator('h1, .topbar').first().waitFor();
  return { app, page };
}

/** Ends the app without the unsaved-changes question a normal close would ask. */
export async function stopApp(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  const exited = app.waitForEvent('close').catch(() => {});
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  await exited;
}

/** The next Open dialog answers with `file`. */
export function answerOpenDialog(app: ElectronApplication, file: string): Promise<void> {
  return app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as typeof dialog.showOpenDialog;
  }, file);
}

/** The next Save dialog answers with `file`. */
export function answerSaveDialog(app: ElectronApplication, file: string): Promise<void> {
  return app.evaluate(({ dialog }, f) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as typeof dialog.showSaveDialog;
  }, file);
}
