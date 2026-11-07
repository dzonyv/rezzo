/** Shared setup for the end-to-end tests. */
import { execFile, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { clipFromWords } from '../src/shared/clips.ts';
import type { Project, Segment } from '../src/shared/project.ts';

const run = promisify(execFile);

function ffmpegBin(): string {
  const root = path.resolve('vendor/tools/ffmpeg');
  const build = readdirSync(root, { withFileTypes: true }).find((d) => d.isDirectory());
  if (!build) throw new Error('FFmpeg missing: run `npm run fetch-tools`');
  return path.join(root, build.name, 'bin');
}

/** expect.poll() for hooks, where vitest doesn't allow it. */
export async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Waits for the open clip's analysis to finish. While MediaPipe starts up
 * it keeps the GPU busy: reading the preview back stalls for most of a second
 * here, and for much longer on a machine with no GPU. Anything that measures
 * time waits for this first.
 */
export async function analysisDone(page: Page): Promise<void> {
  type Analysis = typeof globalThis & { __rezzoAnalysis: { state(): { status: string } } };
  await until(async () => /ready|failed/.test(await page.evaluate(() => (globalThis as Analysis).__rezzoAnalysis.state().status)), 100_000);
}

/** A transcript segment of words 0.5 s apart from `start` to `end`. */
export function segmentOf(start: number, end: number): Segment {
  const words = Array.from({ length: Math.round((end - start) / 0.5) }, (_, i) => ({ text: `reč${i}`, start: start + i * 0.5, end: start + i * 0.5 + 0.4, p: 0.9 }));
  return { start, end: words.at(-1)!.end, words };
}

/** Puts the playhead `seconds` into a clip of `length` seconds by pressing on the timeline's ruler. */
export async function seekTimeline(page: Page, seconds: number, length: number): Promise<void> {
  const timeline = page.locator('.clip-timeline');
  await timeline.scrollIntoViewIfNeeded();
  const box = (await timeline.boundingBox())!;
  await timeline.click({ position: { x: (box.width * seconds) / length, y: 8 } });
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
 * test read which source frame ended up on screen. Its tone stops during `quiet`.
 */
export async function makeNumberedVideo(file: string, { seconds = 20, quiet = [] as [number, number][] } = {}): Promise<string> {
  const bits = `255*mod(floor(N/pow(2\\,floor(X/${NUMBER_BIT_WIDTH})))\\,2)`;
  await run(ffmpegExe(), [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=gray:size=1280x720:rate=30:duration=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
    '-vf', `format=yuv420p,geq=lum='if(lt(Y\\,${NUMBER_STRIP_HEIGHT})\\,${bits}\\,128)':cb=128:cr=128`,
    ...(quiet.length > 0 ? ['-af', quiet.map(([a, b]) => `volume=enable='between(t,${a},${b})':volume=0`).join(',')] : []),
    '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file,
  ]);
  return file;
}

/** The sum of a font table, or a whole font, as 32-bit big-endian words. */
function fontChecksum(bytes: Buffer): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    const word = Buffer.alloc(4);
    bytes.copy(word, 0, i, Math.min(i + 4, bytes.length));
    sum = (sum + word.readUInt32BE(0)) >>> 0;
  }
  return sum;
}

/**
 * A copy of an OFL font from the app under another family name of the same
 * length, for testing fonts the user adds. The checksums are fixed up.
 */
export async function renamedFont(src: string, dst: string, from: string, to: string): Promise<string> {
  if (from.length !== to.length) throw new Error('names must be the same length');
  const font = Buffer.from(await readFile(src));
  const tables = font.readUInt16BE(4);
  let head = -1;
  for (let i = 0; i < tables; i++) {
    const entry = 12 + i * 16;
    const tag = font.toString('latin1', entry, entry + 4);
    const offset = font.readUInt32BE(entry + 8);
    const length = font.readUInt32BE(entry + 12);
    if (tag === 'head') head = offset;
    if (tag !== 'name') continue;
    const table = font.subarray(offset, offset + length);
    // Windows names are UTF-16 big-endian, Mac names single bytes.
    for (const [a, b] of [
      [Buffer.from(from, 'utf16le').swap16(), Buffer.from(to, 'utf16le').swap16()],
      [Buffer.from(from, 'latin1'), Buffer.from(to, 'latin1')],
    ] as const) {
      for (let at = table.indexOf(a); at >= 0; at = table.indexOf(a, at + 1)) b.copy(table, at);
    }
    font.writeUInt32BE(fontChecksum(table), entry + 4);
  }
  if (head < 0) throw new Error('no head table');
  font.writeUInt32BE(0, head + 8);
  font.writeUInt32BE((0xb1b0afba - fontChecksum(font)) >>> 0, head + 8);
  await writeFile(dst, font);
  return dst;
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

/**
 * Starts the app (see appToLaunch) with its own profile and local data
 * folders under `dir`. With `rendererUrl` the page comes from that dev
 * server, as in `npm run dev`, and not from the build.
 */
export async function launchApp(dir: string, rendererUrl = ''): Promise<Launched> {
  const app = await electron.launch({
    ...appToLaunch(),
    env: {
      ...process.env,
      REZZO_USER_DATA: path.join(dir, 'profile'),
      REZZO_LOCAL_DATA: path.join(dir, 'local'),
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
  const page = await app.firstWindow();
  // The smallest window the app allows (minWidth/minHeight in main/index.ts), so a test that only
  // passes on a large screen fails here too, not just on the smaller CI runner.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1000, 640));
  await page.locator('h1, .topbar').first().waitFor();
  return { app, page };
}

/**
 * Starts the app and opens a clip of three synthetic shots, with hard cuts
 * at 2 s and 4 s and nobody in them.
 */
export async function openThreeShots(dir: string, rendererUrl = ''): Promise<Launched> {
  const video = path.join(dir, 'three-shots.mp4');
  await run(ffmpegExe(), [
    '-y', '-v', 'error',
    '-f', 'lavfi', '-i', 'color=c=0x802020:size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'color=c=0x2040a0:size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=6',
    '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]',
    '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video,
  ]);

  const { app, page } = await launchApp(dir, rendererUrl);
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  const file = path.join(dir, 'three-shots.rezzo');
  await answerSaveDialog(app, file);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.keyboard.press('Control+S');
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).includes('"source"'));
  await page.getByRole('button', { name: 'Close project' }).click();

  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  const words = Array.from({ length: 11 }, (_, i) => ({ text: `reč${i}`, start: 0.3 + i * 0.5, end: 0.7 + i * 0.5, p: 0.9 }));
  project.transcript = { language: 'sr', model: 'test', createdAt: new Date().toISOString(), startShift: -0.1, segments: [{ start: 0.3, end: 5.7, words }] };
  project.clips = [clipFromWords(words, project.source!)];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /three-shots/ }).click();
  await page.locator('.clip-list li button').first().click();
  return { app, page };
}

/** The renderer's dev server, as `npm run dev` starts it; on a free port, so a running copy of the app can stay open. */
export async function startDevServer(): Promise<{ url: string; stop(): void }> {
  const { ELECTRON_RENDERER_URL: _, ...env } = process.env;
  const server = spawn(process.execPath, [path.resolve('node_modules/electron-vite/bin/electron-vite.js'), 'dev', '--rendererOnly'], { env });
  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    // Nobody can stop a server this function never returned.
    const stalled = setTimeout(() => {
      server.kill();
      reject(new Error(`the dev server didn't start: ${output}`));
    }, 60_000);
    const read = (chunk: Buffer) => {
      // eslint-disable-next-line no-control-regex
      output += chunk.toString().replace(/\x1b\[[0-9;]*m/g, '');
      const found = /Local:\s+(http:\/\/\S+?)\/?\s/.exec(output);
      if (found) {
        clearTimeout(stalled);
        resolve(found[1]!);
      }
    };
    server.stdout.on('data', read);
    server.stderr.on('data', read);
    server.once('exit', () => {
      clearTimeout(stalled);
      reject(new Error(`the dev server stopped: ${output}`));
    });
  });
  return { url, stop: () => void server.kill() };
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
