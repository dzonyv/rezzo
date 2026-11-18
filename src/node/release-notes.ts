import { CHANGELOG } from '../shared/changelog.ts';

/**
 * The text of a GitHub release: what the version brought, from the
 * changelog in both interface languages, how to get past SmartScreen while
 * the installer isn't signed, and the installer's SHA-256 to check it by.
 */
export function releaseNotes(version: string, installer: string, sha256: string): string {
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
    `Download \`${installer}\` and run it. It installs for your user and doesn't need administrator rights.`,
    '',
    'The installer isn\'t signed yet, so Windows SmartScreen warns you the first time. Click "More info", then "Run anyway".',
    '',
    `SHA-256: \`${sha256}\``,
    '',
  ].join('\n');
}
