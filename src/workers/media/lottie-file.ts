/**
 * Reads a Lottie animation the user picked: a JSON file, or a .lottie
 * package (a zip holding the animation's JSON, and its images, which the
 * player reads from the package itself). Only what's needed to find the
 * JSON is read from the zip: the central directory and that one entry.
 *
 * Runs in the media worker, not the main process: a file from anywhere is
 * unpacked and parsed here, and however long that takes the app's window
 * keeps answering. What's unpacked is capped, since a few kilobytes of zip
 * can hold gigabytes of zeros.
 */
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { inflateRaw } from 'node:zlib';
import { isZip, lottieInfo, MAX_LOTTIE_BYTES, type LottieInfo } from '../../shared/lottie.ts';

const inflate = promisify(inflateRaw);

/** A manifest lists a package's animations and themes; a real one is a few hundred bytes. */
const MAX_MANIFEST_BYTES = 1024 * 1024;

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;

/** The entries of a zip by name: where each one's data starts and how it's stored. */
function zipEntries(zip: Buffer): Map<string, { method: number; size: number; offset: number }> {
  // The end record is at the end, before a comment of up to 64 KiB.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === END_OF_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const entries = new Map<string, { method: number; size: number; offset: number }>();
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== DIRECTORY_ENTRY) throw new Error('broken zip directory');
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    if (zip.readUInt32LE(local) !== LOCAL_HEADER) throw new Error('broken zip entry');
    const offset = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    if (offset + size > zip.length) throw new Error('broken zip entry');
    entries.set(name, { method, size, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** An entry's bytes, unpacked; an error when there would be more than `maxBytes` of them. */
async function unzipEntry(zip: Buffer, entry: { method: number; size: number; offset: number }, maxBytes: number): Promise<Buffer> {
  const data = zip.subarray(entry.offset, entry.offset + entry.size);
  if (entry.method === 0) {
    if (data.length > maxBytes) throw new Error('zip entry too large');
    return data;
  }
  if (entry.method === 8) return inflate(data, { maxOutputLength: maxBytes });
  throw new Error(`zip method ${entry.method} is not supported`);
}

/**
 * The JSON of a .lottie package's first animation: the one its manifest
 * lists first, or else the first animation in it. Version 1 packages keep
 * animations in animations/, version 2 in a/.
 */
async function packagedAnimation(zip: Buffer): Promise<unknown> {
  const entries = zipEntries(zip);
  const read = async (name: string, maxBytes = MAX_LOTTIE_BYTES) => {
    const entry = entries.get(name);
    return entry ? (JSON.parse((await unzipEntry(zip, entry, maxBytes)).toString('utf8')) as unknown) : undefined;
  };
  const manifest = (await read('manifest.json', MAX_MANIFEST_BYTES)) as { animations?: { id?: unknown }[] } | undefined;
  const id = manifest?.animations?.[0]?.id;
  if (typeof id === 'string') {
    const found = (await read(`animations/${id}.json`)) ?? (await read(`a/${id}.json`));
    if (found !== undefined) return found;
  }
  const first = [...entries.keys()].find((name) => /^(animations|a)\/[^/]+\.json$/.test(name));
  return first ? read(first) : undefined;
}

/** What the animation in `file` says about itself; null when it isn't one, "external-images" when it needs files beside it. */
export async function readLottieInfo(file: string): Promise<LottieInfo | 'external-images' | null> {
  try {
    const bytes = await readFile(file);
    // A package is told by its content, as the page does (render/lottie.ts), so a renamed file still reads.
    const packaged = isZip(bytes);
    // TextDecoder drops a byte order mark, which some editors save JSON with.
    const json = packaged ? await packagedAnimation(bytes) : (JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    return lottieInfo(json, { packaged });
  } catch {
    return null;
  }
}
