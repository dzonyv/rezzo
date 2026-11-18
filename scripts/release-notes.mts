/**
 * Writes the text of a GitHub release for the installer in release/, used
 * by .github/workflows/release.yml:
 *
 *   node scripts/release-notes.mts <version> <installer> <sha256> > notes.md
 */
import { releaseNotes } from '../src/node/release-notes.ts';

const [version, installer, sha256] = process.argv.slice(2);
if (!version || !installer || !sha256) {
  console.error('Usage: node scripts/release-notes.mts <version> <installer> <sha256>');
  process.exit(1);
}
process.stdout.write(releaseNotes(version, installer, sha256));
