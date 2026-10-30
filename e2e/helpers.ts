/** Shared setup for the end-to-end tests. */
import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';

const run = promisify(execFile);

function ffmpegBin(): string {
  const root = path.resolve('vendor/tools/ffmpeg');
  const build = readdirSync(root, { withFileTypes: true }).find((d) => d.isDirectory());
  if (!build) throw new Error('FFmpeg missing: run `npm run fetch-tools`');
  return path.join(root, build.name, 'bin');
}

export const ffmpegExe = (): string => path.join(ffmpegBin(), 'ffmpeg.exe');
export const ffprobeExe = (): string => path.join(ffmpegBin(), 'ffprobe.exe');

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

/** Width of one bit block in makeNumberedVideo's frame-number strip, in source pixels. */
export const NUMBER_BIT_WIDTH = 80;
/** Height of the strip along the top. */
export const NUMBER_STRIP_HEIGHT = 40;

/**
 * A 1280×720 video at 30 fps whose frames show their own number: 16 black
 * or white blocks along the top, lowest bit on the left, over grey. Lets a
 * test read which source frame ended up on screen.
 */
export async function makeNumberedVideo(file: string, { seconds = 20 } = {}): Promise<string> {
  const bits = `255*mod(floor(N/pow(2\\,floor(X/${NUMBER_BIT_WIDTH})))\\,2)`;
  await run(ffmpegExe(), [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=gray:size=1280x720:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-vf', `format=yuv420p,geq=lum='if(lt(Y\\,${NUMBER_STRIP_HEIGHT})\\,${bits}\\,128)':cb=128:cr=128`,
    '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ]);
  return file;
}

export interface Launched {
  app: ElectronApplication;
  page: Page;
}

/** Which app to start: the build in out/, or the packaged Rezzo.exe named in REZZO_E2E_EXECUTABLE. */
export function appToLaunch(): { executablePath?: string; args: string[] } {
  const executable = process.env['REZZO_E2E_EXECUTABLE'];
  return executable ? { executablePath: path.resolve(executable), args: [] } : { args: [path.resolve('out/main/index.js')] };
}

/** Starts the app (see appToLaunch) with its own profile and local data folders under `dir`. */
export async function launchApp(dir: string): Promise<Launched> {
  const app = await electron.launch({
    ...appToLaunch(),
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
