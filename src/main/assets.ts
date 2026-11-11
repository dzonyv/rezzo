/**
 * Files the clips' layers show or play: images, videos, animations and sound files. Like the source video they
 * stay where they are: the project keeps the path and a fingerprint, and a
 * moved file is found again by asking for it and checking the fingerprint.
 */
import { dialog, type BrowserWindow } from 'electron';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AddAssetResult, LocateAssetResult } from '../shared/api.ts';
import {
  ASSET_EXTENSIONS, ASSET_KINDS, assetFileSchema, hasExtensionOf, MAX_AUDIO_BYTES, MAX_AUDIO_SECONDS, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
  type AssetFile, type AssetKind, type AssetStatus,
} from '../shared/assets.ts';
import { MAX_LOTTIE_BYTES } from '../shared/lottie.ts';
import { translate } from '../shared/translate.ts';
import { WorkerError } from '../shared/worker-api.ts';
import { assetUrl, rememberAsset } from './media-protocol.ts';
import { getSettings } from './settings.ts';
import { callWorker, READ_TIMEOUT_MS } from './worker-host.ts';

const kindSchema = z.enum(ASSET_KINDS);
const KINDS: Record<AssetKind, { maxBytes: number; label: string }> = {
  image: { maxBytes: MAX_IMAGE_BYTES, label: 'files.image' },
  video: { maxBytes: MAX_VIDEO_BYTES, label: 'files.video' },
  lottie: { maxBytes: MAX_LOTTIE_BYTES, label: 'files.lottie' },
  audio: { maxBytes: MAX_AUDIO_BYTES, label: 'files.audio' },
};

async function chooseFile(win: BrowserWindow, kind: AssetKind): Promise<string | null> {
  const { uiLanguage } = await getSettings();
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: translate(uiLanguage, KINDS[kind].label), extensions: [...ASSET_EXTENSIONS[kind]] }],
  });
  return canceled ? null : (filePaths[0] ?? null);
}

/** Checks a file the user picked and fingerprints it; reads a video's or a sound's streams or an animation's JSON too. */
async function inspectFile(file: string, kind: AssetKind): Promise<AddAssetResult> {
  if (!hasExtensionOf(kind, file)) return { ok: false, error: 'unreadable' };
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) return { ok: false, error: 'unreadable' };
    size = info.size;
  } catch {
    return { ok: false, error: 'unreadable' };
  }
  if (size > KINDS[kind].maxBytes) return { ok: false, error: 'too-large' };
  const read = await Promise.all([
    // A file that stops answering is one Rezzo can't read; any other failure is reported as it is.
    callWorker('fingerprint', [file], { timeoutMs: READ_TIMEOUT_MS }).catch((e: unknown) => {
      if (e instanceof WorkerError && e.code === 'timeout') return null;
      throw e;
    }),
    kind === 'video' ? callWorker('probeVideo', [file], { timeoutMs: READ_TIMEOUT_MS }).catch(() => null) : undefined,
    kind === 'lottie' ? callWorker('readLottie', [file], { timeoutMs: READ_TIMEOUT_MS }).catch(() => null) : undefined,
    kind === 'audio' ? callWorker('probeAudio', [file], { timeoutMs: READ_TIMEOUT_MS }).catch(() => null) : undefined,
  ]);
  const [fingerprint, video, lottie, audio] = read;
  if (fingerprint === null || video === null || lottie === null || audio === null) return { ok: false, error: 'unreadable' };
  if (lottie === 'external-images') return { ok: false, error: 'external-images' };
  if (audio && audio.duration > MAX_AUDIO_SECONDS) return { ok: false, error: 'too-long' };
  rememberAsset(file);
  const asset: AssetFile = { path: file, name: path.basename(file), size, fingerprint };
  return { ok: true, file: asset, url: assetUrl(file), ...(video && { video }), ...(lottie && { lottie }), ...(audio && { audio }) };
}

/** Asks for a file of this kind. Null: the user cancelled. */
export async function addAsset(win: BrowserWindow, kindArg: unknown): Promise<AddAssetResult | null> {
  const kind = kindSchema.parse(kindArg);
  const file = await chooseFile(win, kind);
  return file ? inspectFile(file, kind) : null;
}

/** Whether the file is still where the project says, and still the same size. */
export async function checkAsset(asset: unknown): Promise<AssetStatus> {
  const { path: file, size } = assetFileSchema.parse(asset);
  try {
    return (await stat(file)).size === size ? 'ok' : 'changed';
  } catch {
    return 'missing';
  }
}

/** Asks where the file went and accepts only the same file. Null: cancelled. */
export async function locateAsset(win: BrowserWindow, kindArg: unknown, asset: unknown): Promise<LocateAssetResult | null> {
  const kind = kindSchema.parse(kindArg);
  const expected = assetFileSchema.parse(asset);
  const file = await chooseFile(win, kind);
  if (!file) return null;
  const found = await inspectFile(file, kind);
  if (found.ok && found.file.fingerprint !== expected.fingerprint) return { ok: false, error: 'different-file' };
  return found;
}

/** A URL the page can read the file from; only files the app came across itself. */
export function assetFileUrl(asset: unknown): string {
  return assetUrl(assetFileSchema.parse(asset).path);
}
