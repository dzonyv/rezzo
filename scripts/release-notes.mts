/**
 * Writes the text of a GitHub release, used by
 * .github/workflows/release.yml:
 *
 *   node scripts/release-notes.mts <version> <installer> > notes.md
 */
import { releaseNotes } from '../src/node/release-notes.ts';

const [version, installer] = process.argv.slice(2);
if (!version || !installer) {
  console.error('Usage: node scripts/release-notes.mts <version> <installer>');
  process.exit(1);
}
process.stdout.write(releaseNotes(version, installer));
