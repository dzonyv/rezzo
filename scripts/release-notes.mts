/**
 * Writes the text of a GitHub release, used by
 * .github/workflows/release.yml:
 *
 *   node scripts/release-notes.mts <version> <installer> [--signed] > notes.md
 *
 * --signed once the installer is code-signed: the text then leaves out
 * what to do about SmartScreen's warning.
 */
import { releaseNotes } from '../src/node/release-notes.ts';

const args = process.argv.slice(2);
const signed = args.includes('--signed');
const [version, installer] = args.filter((a) => a !== '--signed');
if (!version || !installer) {
  console.error('Usage: node scripts/release-notes.mts <version> <installer> [--signed]');
  process.exit(1);
}
process.stdout.write(releaseNotes(version, { installer, signed }));
