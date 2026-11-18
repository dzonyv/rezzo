/**
 * Covers: the Cover tool turning the editor to the cover, framing it on
 * its own and picking its moment, a title on it that the clip doesn't
 * get, the saved project, and the PNG and JPG drawn as the preview is;
 * the cutout, effects and templates on the cover, the cover on the
 * exported video's first frames, and the safe zones.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ElectronApplication, Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultVideoLayer, valueAt } from '../src/shared/framing.ts';
import { MAX_JPG_BYTES } from '../src/shared/cover.ts';
import { PROJECT_FORMAT, videoLayerOf, type Project } from '../src/shared/project.ts';
import { analysisDone, answerOpenDialog, answerSaveDialog, ffmpegExe, launchApp, makeNumberedVideo, NUMBER_BIT_WIDTH, NUMBER_STRIP_HEIGHT, openTool, pickView, stopApp, until } from './helpers.ts';

const run = promisify(execFile);

/** `window` inside page.evaluate(); this config has no DOM types. */
type PageGlobal = typeof globalThis & { __rezzoPreview?: { readRow(y: number): number[] } };

const W = 1080;
const H = 1920;
/** The clip: 2 s to 6 s of the source, at 30 fps. */
const START = 2;
const END = 6;
/** A new title on the cover is centred across, its middle 0.4 of the way down: on the picture in Full. */
const TITLE_ROW = Math.round(0.4 * H);
/** Full: the 1280×720 source scaled to 1080 wide and centred, so its number strip sits here. */
const SCALE = W / 1280;
const NUMBER_ROW = Math.round((H - 720 * SCALE) / 2 + (NUMBER_STRIP_HEIGHT / 2) * SCALE);
const bitX = (b: number) => Math.round((b + 0.5) * NUMBER_BIT_WIDTH * SCALE);

let dir: string;
let app: ElectronApplication | undefined;
let page: Page;
let file: string;

const previewRow = (y: number) => page.evaluate((r) => (globalThis as PageGlobal).__rezzoPreview?.readRow(r) ?? [], y);

/** The source frame on screen in Full, from its number strip. */
async function frameOnScreen(): Promise<number> {
  const row = await previewRow(NUMBER_ROW);
  let n = 0;
  for (let b = 0; b < 16; b++) if (row[bitX(b) * 4]! > 128) n |= 1 << b;
  return n;
}

/** How many pixels of the preview's title row are white (letters) and black (outline). */
async function inks(): Promise<{ white: number; black: number }> {
  const row = await previewRow(TITLE_ROW);
  let white = 0;
  let black = 0;
  for (let x = 0; x < W; x++) {
    const [r, g, b] = [row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!];
    if (r > 220 && g > 220 && b > 220) white++;
    if (r < 40 && g < 40 && b < 40) black++;
  }
  return { white, black };
}

async function saved(): Promise<Project> {
  await page.keyboard.press('Control+S');
  await expect.poll(() => page.locator('.topbar .dirty').count()).toBe(0);
  return JSON.parse(await readFile(file, 'utf8')) as Project;
}

/** A picture file as grey levels, one byte a pixel, top row first. */
async function luma(picture: string): Promise<Buffer> {
  const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', picture, '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 26 });
  return stdout;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-e2e-'));
  const video = await makeNumberedVideo(path.join(dir, 'numbered.mp4'), { seconds: 10 });
  await mkdir(path.join(dir, 'out'));

  ({ app, page } = await launchApp(dir));
  await answerOpenDialog(app, video);
  await page.getByRole('button', { name: 'New project' }).click();
  file = path.join(dir, 'numbered.rezzo');
  await answerSaveDialog(app, file);
  await page.getByRole('textbox', { name: 'Project name' }).waitFor();
  await page.keyboard.press('Control+S');
  await until(async () => (await readFile(file, 'utf8').catch(() => '')).includes('"source"'));
  await page.getByRole('button', { name: 'Close project' }).click();

  const project = JSON.parse(await readFile(file, 'utf8')) as Project;
  project.transcript = {
    language: 'sr',
    model: 'test',
    createdAt: new Date().toISOString(),
    startShift: -0.1,
    segments: [
      {
        start: 2.1,
        end: 2.9,
        words: [
          { text: 'Ona', start: 2.1, end: 2.4, p: 0.9 },
          { text: 'laže.', start: 2.5, end: 2.9, p: 0.9 },
        ],
      },
    ],
  };
  project.clips = [{ id: crypto.randomUUID(), name: 'Naslovna', start: START, end: END, skips: [], evenLoudness: false, layers: [defaultVideoLayer(START)] }];
  await writeFile(file, JSON.stringify(project));
  await page.getByRole('button', { name: /numbered/ }).click();
  await page.locator('.clip-list li', { hasText: 'Naslovna' }).getByRole('button', { name: 'Naslovna' }).click();
  await until(async () => (await previewRow(0)).length > 0, 20_000);
  await analysisDone(page);
});

afterAll(async () => {
  await stopApp(app);
  await rm(dir, { recursive: true, force: true });
});

describe('covers', () => {
  it('frames the cover on its own and picks its moment', async () => {
    await openTool(page, 'Cover');
    await page.locator('.clip-editor .cover-moment').waitFor();
    await page.locator('.layouts').getByRole('button', { name: 'Full' }).click();
    await expect.poll(frameOnScreen, { timeout: 10_000 }).toBe(START * 30);
    // A second and three frames on.
    await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(frameOnScreen, { timeout: 10_000 }).toBe(93);
  });

  it('puts a title on the cover, not on the clip', async () => {
    expect(await inks()).toEqual({ white: 0, black: 0 });
    await page.locator('.clip-drawer .add-tiles').getByRole('button', { name: 'Text' }).click();
    await page.getByRole('heading', { name: 'Text: Your title here' }).waitFor();
    await expect.poll(async () => (await inks()).white, { timeout: 10_000 }).toBeGreaterThan(20);
    expect((await inks()).black).toBeGreaterThan(20);

    // Back on the clip: its own framing (Follow), no title, nothing on its timeline.
    await openTool(page, 'Layers');
    await page.locator('.clip-timeline').waitFor();
    expect(await page.locator('.clip-timeline .layer-bar').count()).toBe(0);
    await expect.poll(async () => (await inks()).white, { timeout: 10_000 }).toBe(0);
  });

  it('keeps the cover in the saved project', async () => {
    const project = await saved();
    const clip = project.clips[0]!;
    expect(valueAt(videoLayerOf(clip).layout, 3.1)).toBe('follow');
    expect(clip.layers.map((l) => l.kind)).toEqual(['video']);
    expect(clip.cover).toMatchObject({ time: 3.1, layers: [{ kind: 'text', text: 'Your *title* here' }] });
    expect(clip.cover!.video!.layout).toEqual([expect.objectContaining({ value: 'full' })]);
  });

  it('saves the cover as the preview draws it, as PNG and as a small JPG', async () => {
    await openTool(page, 'Cover');
    await expect.poll(frameOnScreen, { timeout: 10_000 }).toBe(93);
    const png = path.join(dir, 'out', 'naslovna.png');
    await answerSaveDialog(app!, png);
    await page.getByRole('button', { name: 'Save PNG' }).click();
    await page.getByText('Saved the cover as naslovna.png.').waitFor({ timeout: 20_000 });

    const pixels = await luma(png);
    expect(pixels.length).toBe(W * H);
    let n = 0;
    for (let b = 0; b < 16; b++) if (pixels[NUMBER_ROW * W + bitX(b)]! > 128) n |= 1 << b;
    expect(n).toBe(93);
    const row = pixels.subarray(TITLE_ROW * W, (TITLE_ROW + 1) * W);
    expect(row.filter((v) => v > 220).length).toBeGreaterThan(20);
    expect(row.filter((v) => v < 40).length).toBeGreaterThan(20);

    const jpg = path.join(dir, 'out', 'naslovna.jpg');
    await answerSaveDialog(app!, jpg);
    await page.getByRole('button', { name: 'Save JPG' }).click();
    await page.getByText('Saved the cover as naslovna.jpg.').waitFor({ timeout: 20_000 });
    expect((await stat(jpg)).size).toBeLessThanOrEqual(MAX_JPG_BYTES);
    expect((await luma(jpg)).length).toBe(W * H);
  });

  it('suggests frames to choose from', async () => {
    await page.keyboard.press('Escape');
    const frames = page.locator('.cover-frames button');
    await expect.poll(() => frames.count(), { timeout: 20_000 }).toBe(4);
    // Nobody in the test video: they're spread over the clip, none of them the frame the cover has.
    const name = (await frames.and(page.locator('[aria-pressed="false"]')).first().getAttribute('title'))!;
    const other = page.locator(`.cover-frames button[title="${name}"]`);
    await other.click();
    await expect.poll(() => other.getAttribute('aria-pressed')).toBe('true');
    await expect.poll(frameOnScreen, { timeout: 10_000 }).not.toBe(93);
  });

  it('titles the cover with words picked in the transcript', async () => {
    await openTool(page, 'Text');
    const from = (await page.locator('.w', { hasText: 'Ona' }).boundingBox())!;
    const to = (await page.locator('.w', { hasText: 'laže.' }).boundingBox())!;
    await page.mouse.move(from.x + 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 5, to.y + to.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(await page.locator('.w.selected').count()).toBe(2);
    await page.getByRole('button', { name: 'Cover title' }).click();
    await page.getByRole('heading', { name: 'Text: Ona laže' }).waitFor();
    expect(await page.locator('.tool-rail').getByRole('button', { name: 'Cover', exact: true }).getAttribute('aria-pressed')).toBe('true');
    const project = await saved();
    expect(project.clips[0]!.cover!.layers.map((l) => (l.kind === 'text' ? l.text : l.kind))).toEqual(['Your *title* here', 'Ona laže']);
  });

  it('cuts the people out over the titles, and finds nobody in a picture without people', async () => {
    await openTool(page, 'Cover');
    const tile = page.locator('.clip-drawer .add-tiles').getByRole('button', { name: 'Cutout' });
    await tile.click();
    await page.getByRole('heading', { name: 'Cutout', exact: true }).waitFor();
    await page.getByRole('slider', { name: 'Outline' }).waitFor();
    // The numbered video has nobody in it: the titles stay in front, with no outline round anything.
    const png = path.join(dir, 'out', 'cutout.png');
    await answerSaveDialog(app!, png);
    await page.getByRole('button', { name: 'Save PNG' }).click();
    await page.getByText('Saved the cover as cutout.png.').waitFor({ timeout: 30_000 });
    expect(await page.getByText(/Couldn't find the people/).count()).toBe(0);
    await expect.poll(async () => (await inks()).white, { timeout: 10_000 }).toBeGreaterThan(20);
    const row = (await luma(png)).subarray(TITLE_ROW * W, (TITLE_ROW + 1) * W);
    expect(row.filter((v) => v > 220).length).toBeGreaterThan(20);

    // The tile selects the cutout that's there rather than adding another.
    await page.keyboard.press('Escape');
    await tile.click();
    await page.getByRole('heading', { name: 'Cutout', exact: true }).waitFor();
    const project = await saved();
    expect(project.clips[0]!.cover!.layers.map((l) => l.kind)).toEqual(['text', 'text', 'cutout']);
  });

  it('draws the outline round the people it finds, in the colour picked', async () => {
    /** Red pixels in the rows just under the number strip, where an outline round its white blocks goes. */
    const red = async () => {
      let n = 0;
      for (let y = NUMBER_ROW; y < NUMBER_ROW + 40; y++) {
        const row = await previewRow(y);
        for (let x = 0; x < W; x++) if (row[x * 4]! > 200 && row[x * 4 + 1]! < 80 && row[x * 4 + 2]! < 80) n++;
      }
      return n;
    };
    await page.locator('.clip-drawer .cutout-section input[type="color"]').fill('#ff0000');
    expect(await red()).toBe(0);
    await page.evaluate(() => (globalThis as PageGlobal & { __rezzoPreview: { whiteIsPeople(): void } }).__rezzoPreview.whiteIsPeople());
    // Another frame, so the people are looked for again.
    await page.getByRole('button', { name: 'A frame later' }).click();
    await expect.poll(red, { timeout: 10_000 }).toBeGreaterThan(50);
    // Just under the strip, red under each white block and none under a black one.
    const under = await previewRow(Math.round((H - 720 * SCALE) / 2 + NUMBER_STRIP_HEIGHT * SCALE) + 4);
    const frame = await frameOnScreen();
    const bits = Array.from({ length: 8 }, (_, b) => (frame >> b) & 1);
    expect(bits).toContain(0);
    expect(bits.map((_, b) => (under[bitX(b) * 4]! > 200 && under[bitX(b) * 4 + 1]! < 80 ? 1 : 0))).toEqual(bits);
    await page.getByRole('button', { name: 'A frame earlier' }).click();
  });

  it('puts a gradient on the cover from the edge picked, under the titles and the cutout', async () => {
    /** The share of a preview row in a colour. */
    const share = async (y: number, is: (r: number, g: number, b: number) => boolean) => {
      const row = await previewRow(y);
      let n = 0;
      for (let x = 0; x < W; x++) if (is(row[x * 4]!, row[x * 4 + 1]!, row[x * 4 + 2]!)) n++;
      return n / W;
    };
    const dark = (y: number) => share(y, (r, g, b) => r < 30 && g < 30 && b < 30);
    const red = (y: number) => share(y, (r, g, b) => r > 200 && g < 60 && b < 60);
    const BOTTOM = H - 3;
    const TOP = 2;
    await openTool(page, 'Cover');
    await page.keyboard.press('Escape');
    expect(await dark(BOTTOM)).toBeLessThan(0.1);
    // The blurred number strip makes the top dark already.
    const top = await dark(TOP);
    const tile = page.locator('.clip-drawer .cover-effect-tiles').getByRole('button', { name: 'Gradient' });
    expect(await tile.getAttribute('aria-pressed')).toBe('false');
    await tile.click();
    await page.getByRole('heading', { name: 'Effect: Gradient' }).waitFor();
    // Black from the bottom, half way up: the titles further up stay as they were.
    await expect.poll(() => dark(BOTTOM), { timeout: 10_000 }).toBeGreaterThan(0.95);
    expect(await dark(TOP)).toBe(top);
    expect((await inks()).white).toBeGreaterThan(20);
    expect(await page.getByRole('button', { name: 'Add keyframe' }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Duplicate' }).count()).toBe(0);

    await page.locator('.clip-drawer .layer-panel input[type="color"]').fill('#ff0000');
    await expect.poll(() => red(BOTTOM), { timeout: 10_000 }).toBeGreaterThan(0.95);
    await page.getByRole('slider', { name: 'Edge' }).fill('180');
    await expect.poll(() => red(TOP), { timeout: 10_000 }).toBeGreaterThan(0.95);
    expect(await red(BOTTOM)).toBeLessThan(0.05);

    // It went in under everything else; the tile now selects it.
    let project = await saved();
    expect(project.format).toBe(PROJECT_FORMAT);
    expect(project.clips[0]!.cover!.layers.map((l) => (l.kind === 'effect' ? l.effect : l.kind))).toEqual(['gradient', 'text', 'text', 'cutout']);
    expect(project.clips[0]!.cover!.layers[0]).toMatchObject({ color: '#ff0000', params: { angle: 180, reach: 0.5 }, intensity: [{ value: 1 }] });
    await page.keyboard.press('Escape');
    expect(await tile.getAttribute('aria-pressed')).toBe('true');
    await tile.click();
    await page.getByRole('heading', { name: 'Effect: Gradient' }).waitFor();
    await page.getByRole('slider', { name: 'Edge' }).fill('0');
    await expect.poll(() => red(BOTTOM), { timeout: 10_000 }).toBeGreaterThan(0.95);
    project = await saved();
    expect(project.clips[0]!.cover!.layers.filter((l) => l.kind === 'effect')).toHaveLength(1);
    // The clip itself has no gradient.
    expect(project.clips[0]!.layers.map((l) => l.kind)).toEqual(['video']);
  });

  it("puts the cover on the exported video's first frames", async () => {
    await openTool(page, 'Cover');
    await page.getByRole('checkbox', { name: "Put the cover on the video's first frames" }).check();
    const time = (await saved()).clips[0]!.cover!.time;
    expect((await saved()).clips[0]!.cover!.inVideo).toBe(true);
    const out = path.join(dir, 'out', 'naslovna.mp4');
    await answerSaveDialog(app!, out);
    await page.locator('.clip-editor header').getByRole('button', { name: 'Export' }).click();
    await page.getByRole('heading', { name: 'Clip exported' }).waitFor({ timeout: 60_000 });
    await page.locator('.export-dialog').getByRole('button', { name: 'Close', exact: true }).click();

    const { stdout } = await run(ffmpegExe(), ['-v', 'error', '-i', out, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1 << 30 });
    const size = W * H;
    // As long as the clip: the cover takes the place of its first frames.
    expect(stdout.length / size).toBe((END - START) * 30);
    const frame = (i: number) => stdout.subarray(i * size, (i + 1) * size);
    const number = (luma: Buffer) => {
      let n = 0;
      for (let b = 0; b < 16; b++) if (luma[NUMBER_ROW * W + bitX(b)]! > 128) n |= 1 << b;
      return n;
    };
    const titled = (luma: Buffer) => luma.subarray(TITLE_ROW * W, (TITLE_ROW + 1) * W).filter((v) => v > 220).length > 20;
    /** How bright the bottom row is: the red gradient's there on the cover, grey on the clip. */
    const bottom = (luma: Buffer) => luma.subarray((H - 3) * W, (H - 2) * W).reduce((a, v) => a + v, 0) / W;
    // A tenth of a second at 30 fps: three frames of the cover (in Full, its moment, with the titles and the gradient), then the clip.
    for (let i = 0; i < 3; i++) {
      expect(number(frame(i))).toBe(Math.round(time * 30));
      expect(titled(frame(i))).toBe(true);
      expect(bottom(frame(i))).toBeLessThan(90);
    }
    expect(titled(frame(3))).toBe(false);
    expect(bottom(frame(3))).toBeGreaterThan(100);
  });

  it("shows a platform's safe zones over the preview, and Instagram's grid on the cover", async () => {
    await pickView(page, 'TikTok');
    await page.locator('.safe-zones .clear').waitFor();
    expect(await page.locator('.safe-zones .grid-crop').count()).toBe(0);
    await pickView(page, 'Instagram Reels');
    await page.locator('.safe-zones .grid-crop').waitFor();
    await pickView(page, 'No safe zones');
    await expect.poll(() => page.locator('.safe-zones').count()).toBe(0);
  });

  it('works the view menu from the keyboard, and closes it without touching the selected layer', async () => {
    await openTool(page, 'Cover');
    await page.locator('.clip-drawer .add-tiles').getByRole('button', { name: 'Text' }).click();
    const selected = page.getByRole('heading', { name: 'Text: Your title here' });
    await selected.waitFor();
    const eye = page.getByRole('button', { name: 'View', exact: true });
    const menu = page.getByRole('menu', { name: 'View' });
    const focused = () => page.locator(':focus').textContent();

    await eye.click();
    await expect.poll(focused).toBe('Show people');
    // Down past "No safe zones" to TikTok, and Space picks it rather than reaching the editor.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).toBe('TikTok');
    await page.keyboard.press('Space');
    await expect.poll(() => menu.getByRole('menuitemradio', { name: 'TikTok' }).getAttribute('aria-checked')).toBe('true');
    await page.locator('.safe-zones .clear').waitFor();
    expect(await page.locator('.view-menu .dot').count()).toBe(1);
    // Up from the first item goes round to the last.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect.poll(focused).toBe('YouTube Shorts');

    // Escape closes the menu only: the layer stays selected, and the eye has focus again.
    await page.keyboard.press('Escape');
    await expect.poll(() => menu.count()).toBe(0);
    expect(await selected.isVisible()).toBe(true);
    await expect.poll(() => eye.evaluate((el) => el === (el.ownerDocument as { activeElement: unknown }).activeElement)).toBe(true);

    // A press elsewhere closes it too.
    await eye.click();
    await menu.waitFor();
    await page.locator('.clip-editor .clip-name').click();
    await expect.poll(() => menu.count()).toBe(0);

    await pickView(page, 'No safe zones');
    await expect.poll(() => page.locator('.view-menu .dot').count()).toBe(0);
  });

  it('puts a template on the cover, keeping the words of its titles, and saves the cover as a template of your own', async () => {
    await openTool(page, 'Cover');
    await page.keyboard.press('Escape');
    const templates = page.locator('.clip-drawer .cover-template-list');
    const kinds = async () => (await saved()).clips[0]!.cover!.layers.map((l) => (l.kind === 'effect' ? l.effect : l.kind));
    const before = (await saved()).clips[0]!.cover!.layers.filter((l) => l.kind === 'text').map((l) => l.text);

    await templates.getByRole('button', { name: 'Behind the people' }).click();
    // Its title and the cutout in place of what was there; the titles past its one stay over it.
    expect(await kinds()).toEqual(['text', 'cutout', 'text', 'text']);
    const after = (await saved()).clips[0]!.cover!.layers.filter((l) => l.kind === 'text');
    expect(after.map((l) => l.text)).toEqual(before);
    expect(after[0]).toMatchObject({ style: { color: '#ffd400' } });

    await page.getByRole('textbox', { name: 'Template name' }).fill('Moj izgled');
    await page.getByRole('button', { name: 'Save as template' }).click();
    await page.getByText('Saved the template “Moj izgled”.').waitFor();

    await templates.getByRole('button', { name: 'Dark fade' }).click();
    expect(await kinds()).toEqual(['gradient', 'text', 'text', 'text']);
    await templates.getByRole('button', { name: 'Moj izgled', exact: true }).click();
    expect(await kinds()).toEqual(['text', 'cutout', 'text', 'text']);
    expect((await saved()).clips[0]!.cover!.layers.filter((l) => l.kind === 'text').map((l) => l.text)).toEqual(before);

    await templates.getByRole('button', { name: 'Delete the template “Moj izgled”' }).click();
    await expect.poll(() => templates.getByRole('button', { name: 'Moj izgled', exact: true }).count()).toBe(0);
  });
});
