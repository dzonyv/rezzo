/**
 * rezzo-media://: how the sandboxed page plays local video. Only files the
 * app has handed out (the open project's source and its preview proxy) are
 * served, and Range requests are honoured so the player can seek.
 */
import { protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';

export const MEDIA_SCHEME = 'rezzo-media';

const allowed = new Set<string>();
const key = (file: string) => path.resolve(file).toLowerCase();

/** Lets the page play `file`; returns the URL to use. */
export function allowMedia(file: string): string {
  allowed.add(key(file));
  return mediaUrl(file);
}

export function mediaUrl(file: string): string {
  return `${MEDIA_SCHEME}://file/?path=${encodeURIComponent(file)}`;
}

/** Must run before the app is ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.wav': 'audio/wav',
};

/** Parses "bytes=a-b", "bytes=a-" or "bytes=-n" against a file size; null if absent or unusable. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const file = new URL(request.url).searchParams.get('path');
    if (!file || !allowed.has(key(file))) return new Response(null, { status: 403 });
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      return new Response(null, { status: 404 });
    }
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    });
    const rangeHeader = request.headers.get('Range');
    const range = parseRange(rangeHeader, size);
    if (rangeHeader && !range) {
      headers.set('Content-Range', `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    headers.set('Content-Length', String(end - start + 1));
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    const body = size === 0 ? null : (Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream);
    return new Response(body, { status: range ? 206 : 200, headers });
  });
}
