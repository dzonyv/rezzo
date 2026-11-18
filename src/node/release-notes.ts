import { CHANGELOG } from '../shared/changelog.ts';

/**
 * The text of a GitHub release: what the version brought, from the
 * changelog in both interface languages, and where to read how to install
 * it. How to install lives in the README only, so it's changed in one
 * place (when the installer gets signed, say). The checksum is in
 * SHA256SUMS.txt next to the installer, not here: a rebuild replaces that
 * file but leaves this text as it was.
 */
export function releaseNotes(version: string, installer: string): string {
  const release = CHANGELOG.find((r) => r.version === version);
  if (!release) throw new Error(`No changelog entry for ${version}: add one to src/shared/changelog.ts`);
  const list = (lines: string[]) => lines.map((line) => `- ${line}`).join('\n');
  return [
    '## What it brings',
    '',
    list(release.changes.en),
    '',
    '## Šta donosi',
    '',
    list(release.changes.sh),
    '',
    '## Installing',
    '',
    `Download \`${installer}\` and run it. The [README](https://github.com/dzonyv/rezzo#download) says what to do when Windows warns you about it. \`SHA256SUMS.txt\` has its SHA-256.`,
    '',
  ].join('\n');
}
