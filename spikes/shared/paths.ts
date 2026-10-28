import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root (spikes/ lives one level below it). */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Downloaded third-party binaries. Ignored by git. */
export const vendorDir = path.join(repoRoot, 'vendor', 'bin');

/** Downloaded models. Ignored by git. */
export const modelsDir = path.join(repoRoot, 'models');

/**
 * Real footage and everything derived from it (transcripts, debug videos).
 * Lives outside the repo on purpose; override with REZZO_MEDIA.
 */
export const mediaDir = process.env.REZZO_MEDIA ?? 'D:\\RezzoMedia\\phase0';
