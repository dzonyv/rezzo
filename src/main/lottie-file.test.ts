import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zip } from '../../e2e/zip.ts';
import { readLottieInfo } from './lottie-file.ts';

const animation = { v: '5.7.4', fr: 25, ip: 0, op: 50, w: 300, h: 150, layers: [], assets: [{ id: 'i', u: '/i/', p: 'img_0.png', e: 0 }] };

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'rezzo-lottie-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Lottie files', () => {
  const info = { width: 300, height: 150, frameRate: 25, frames: 50 };

  it('reads a JSON animation, with or without a byte order mark', async () => {
    const plain = path.join(dir, 'plain.json');
    await writeFile(plain, `${String.fromCharCode(0xfeff)}${JSON.stringify({ ...animation, assets: [] })}`);
    expect(await readLottieInfo(plain)).toEqual(info);
  });

  it('refuses a JSON animation that shows images kept beside it', async () => {
    const file = path.join(dir, 'images.json');
    await writeFile(file, JSON.stringify(animation));
    expect(await readLottieInfo(file)).toBe('external-images');
  });

  it('reads the animation the manifest of a .lottie package names first', async () => {
    const file = path.join(dir, 'package.lottie');
    await writeFile(
      file,
      zip({
        'manifest.json': JSON.stringify({ version: '1', animations: [{ id: 'second' }, { id: 'first' }] }),
        'animations/first.json': JSON.stringify({ ...animation, w: 10 }),
        'animations/second.json': JSON.stringify(animation),
      }),
    );
    expect(await readLottieInfo(file)).toEqual(info);
  });

  it('finds the animation in a version 2 package without a usable manifest', async () => {
    const file = path.join(dir, 'v2.lottie');
    await writeFile(file, zip({ 'manifest.json': '{}', 'a/only.json': JSON.stringify(animation) }));
    expect(await readLottieInfo(file)).toEqual(info);
  });

  it('tells a package from JSON by its content, not its name', async () => {
    const renamed = path.join(dir, 'renamed.json');
    await writeFile(renamed, zip({ 'manifest.json': '{}', 'a/only.json': JSON.stringify(animation) }));
    expect(await readLottieInfo(renamed)).toEqual(info);
  });

  it('rejects files that are not animations', async () => {
    const text = path.join(dir, 'notes.json');
    await writeFile(text, '{"hello": "world"}');
    expect(await readLottieInfo(text)).toBeNull();
    const broken = path.join(dir, 'broken.lottie');
    await writeFile(broken, 'not a zip');
    expect(await readLottieInfo(broken)).toBeNull();
  });
});
