/**
 * The log: what went wrong, kept in a text file in the user data folder
 * so a bug report can come with it. Errors and warnings only, from the
 * main process, the page (its console) and the media worker, plus one
 * line at startup about the app and the machine. Nothing is sent
 * anywhere; the home screen opens the folder.
 *
 * Writing is synchronous: it's rare, and a line written just before a
 * crash is the one that matters.
 */
import { app, shell } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Not app.getVersion(): run from source, that's Electron's own version.
import { version } from '../../package.json';

export type LogLevel = 'info' | 'warn' | 'error';

/** Past this the file starts over, the previous one kept as rezzo.old.log: two of them are plenty for a report. */
const MAX_BYTES = 1_000_000;
/** The longest message kept, so one runaway message doesn't fill the file. */
const MAX_MESSAGE = 4000;
/**
 * At most this many lines a second; past it lines are counted, not
 * written, so a warning on every frame of a preview neither fills the file
 * nor holds up the main process.
 */
const MAX_PER_SECOND = 20;

export const logDir = (): string => path.join(app.getPath('userData'), 'logs');
const logFile = () => path.join(logDir(), 'rezzo.log');

/** The file's size as far as this run knows; read once, with the folder made. */
let size: number | undefined;
/** The last line asked for and how many times since it was written, so repeats become one line. */
let last = { key: '', repeats: 0 };
/** Lines written in the current second, and how many were left out. */
let second = { at: 0, written: 0, dropped: 0 };
/** The file couldn't be started over this run; it isn't tried again on every line. */
let stuck = false;

/** One line in the log: when, how bad, where from, what. A message of several lines is indented under it. */
export function formatLine(when: Date, level: LogLevel, from: string, message: string): string {
  const text = message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message;
  return `${when.toISOString()} ${level.padEnd(5)} [${from}] ${text.replace(/\r?\n/g, '\n    ')}\n`;
}

export function log(level: LogLevel, from: string, message: string): void {
  const now = new Date();
  const key = `${level} ${from} ${message}`;
  if (key === last.key) {
    last.repeats++;
    return;
  }
  const tick = Math.floor(now.getTime() / 1000);
  if (tick !== second.at) second = { at: tick, written: 0, dropped: second.dropped };
  if (second.written >= MAX_PER_SECOND) {
    second.dropped++;
    return;
  }
  let text = '';
  if (last.repeats > 0) text += formatLine(now, 'info', 'log', `the line above came ${last.repeats} more time(s)`);
  if (second.dropped > 0) text += formatLine(now, 'info', 'log', `${second.dropped} line(s) left out, too many at once`);
  text += formatLine(now, level, from, message);
  last = { key, repeats: 0 };
  second.written++;
  second.dropped = 0;
  write(text);
}

function write(text: string): void {
  try {
    const file = logFile();
    if (size === undefined) {
      mkdirSync(logDir(), { recursive: true });
      size = existsSync(file) ? statSync(file).size : 0;
    }
    if (size > MAX_BYTES && !stuck) {
      try {
        renameSync(file, path.join(logDir(), 'rezzo.old.log'));
        size = 0;
      } catch {
        // The old file is held open somewhere: keep writing to this one rather than stop.
        stuck = true;
      }
    }
    appendFileSync(file, text, 'utf8');
    size += Buffer.byteLength(text);
  } catch {
    // A log that can't be written mustn't break what it was about to describe.
  }
}

/** An error as the log shows it: its stack if it has one. */
export const errorText = (e: unknown): string => (e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e));

/** An error that only says something was stopped on purpose: nothing went wrong. */
export function isCancel(e: unknown): boolean {
  const err = e as { name?: unknown; code?: unknown } | null;
  return err?.name === 'AbortError' || err?.code === 'cancelled';
}

/** A job that failed (not one that was cancelled). */
export const logFailure = (job: string, e: unknown): void => log('error', job, errorText(e));

/** The first lines of a run: which app and what it runs on, which most reports need. */
export function logStart(): void {
  log('info', 'app', `Rezzo ${version}, Electron ${process.versions.electron}, ${os.type()} ${os.release()} ${process.arch}`);
  // The graphics card is known once the GPU process is up; export and the preview depend on it.
  app.getGPUInfo('complete').then(
    (info) => log('info', 'gpu', gpuLine(info)),
    (e: unknown) => log('warn', 'gpu', `no GPU information: ${errorText(e)}`),
  );
}

/** The card's name and driver from what Chromium reports, or the raw ids when it has no name. */
function gpuLine(info: unknown): string {
  const gpu = info as { auxAttributes?: { glRenderer?: string }; gpuDevice?: { vendorId?: number; deviceId?: number; driverVersion?: string; active?: boolean }[] };
  const device = gpu.gpuDevice?.find((d) => d.active) ?? gpu.gpuDevice?.[0];
  const name = gpu.auxAttributes?.glRenderer ?? (device ? `vendor ${device.vendorId?.toString(16)} device ${device.deviceId?.toString(16)}` : 'unknown');
  return device?.driverVersion ? `${name}, driver ${device.driverVersion}` : name;
}

/** Opens the folder the log is in. */
export async function revealLog(): Promise<void> {
  mkdirSync(logDir(), { recursive: true });
  await shell.openPath(logDir());
}
