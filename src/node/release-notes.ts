import { CHANGELOG } from '../shared/changelog.ts';

/**
 * The text of a GitHub release, in English and then Serbian: what the
 * version brought, from the changelog, and how to install it, SmartScreen's
 * warning included while the installer isn't signed. The README has the
 * same advice in English; this page is where people read it as they
 * download, so it's here in both languages. The checksum is in
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
    '## Installing',
    '',
    `Download \`${installer}\` and run it. It installs for your user and doesn't need administrator rights.`,
    '',
    'The installer isn\'t signed yet, so Windows SmartScreen warns you the first time. Click "More info", then "Run anyway". `SHA256SUMS.txt` has its SHA-256, to check the download by.',
    '',
    '## Šta donosi',
    '',
    list(release.changes.sh),
    '',
    '## Instalacija',
    '',
    `Preuzmi \`${installer}\` i pokreni ga. Instalira se samo za tvog korisnika i ne traži administratorska prava.`,
    '',
    'Instaler još nije potpisan, pa Windows SmartScreen prvi put upozori na njega. Klikni „More info”, pa „Run anyway”. U `SHA256SUMS.txt` je njegov SHA-256, za proveru preuzetog fajla.',
    '',
  ].join('\n');
}
