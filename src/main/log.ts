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

export const logDir = (): string => path.join(app.getPath('userData'), 'logs');
const logFile = () => path.join(logDir(), 'rezzo.log');

/** The file's size as far as this run knows; read once. */
let size: number | undefined;

/** One line in the log: when, how bad, where from, what. A message of several lines is indented under it. */
export function formatLine(when: Date, level: LogLevel, from: string, message: string): string {
  const text = message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message;
  return `${when.toISOString()} ${level.padEnd(5)} [${from}] ${text.replace(/\r?\n/g, '\n    ')}\n`;
}

export function log(level: LogLevel, from: string, message: string): void {
  try {
    const file = logFile();
    mkdirSync(logDir(), { recursive: true });
    size ??= existsSync(file) ? statSync(file).size : 0;
    if (size > MAX_BYTES) {
      renameSync(file, path.join(logDir(), 'rezzo.old.log'));
      size = 0;
    }
    const line = formatLine(new Date(), level, from, message);
    appendFileSync(file, line, 'utf8');
    size += Buffer.byteLength(line);
  } catch {
    // A log that can't be written mustn't break what it was about to describe.
  }
}

/** An error as the log shows it: its stack if it has one. */
export const errorText = (e: unknown): string => (e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e));

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
