import { CHANGELOG } from '../shared/changelog.ts';

export interface InstallerFacts {
  /** The installer's file name, as attached to the release. */
  installer: string;
  /** Whether it's code-signed. Until it is, SmartScreen warns about it and the text says what to do. */
  signed: boolean;
}

/**
 * The text of a GitHub release, in English and then Serbian: what the
 * version brought, from the changelog, and how to install it.
 *
 * What to do about SmartScreen is spelled out in Serbian only: in English
 * it's in the README, which the English part links to, so there's one
 * English copy to keep up to date. Once the installer is signed, neither
 * part mentions SmartScreen.
 *
 * The checksum is in SHA256SUMS.txt next to the installer, not here: a
 * rebuild replaces that file but leaves this text as it was.
 *
 * Both parts end with a link to the code signing policy, which SignPath
 * Foundation asks for on every release page.
 */
const signingPolicy = '[Code signing policy](https://dzonyv.github.io/rezzo/en/potpisivanje/)';
const signingPolicySh = '[Code signing policy](https://dzonyv.github.io/rezzo/potpisivanje/)';

export function releaseNotes(version: string, { installer, signed }: InstallerFacts): string {
  const release = CHANGELOG.find((r) => r.version === version);
  if (!release) throw new Error(`No changelog entry for ${version}: add one to src/shared/changelog.ts`);
  const list = (lines: string[]) => lines.map((line) => `- ${line}`).join('\n');
  const unsigned = (text: string) => (signed ? [] : [text, '']);
  return [
    '## What it brings',
    '',
    list(release.changes.en),
    '',
    '## Installing',
    '',
    `Download \`${installer}\` and run it. It installs for your user and doesn't need administrator rights. \`SHA256SUMS.txt\` has its SHA-256, to check the download by.`,
    '',
    ...unsigned("The installer isn't signed yet, so Windows SmartScreen warns you the first time. The [README](https://github.com/dzonyv/rezzo#download) says what to click."),
    signingPolicy,
    '',
    '## Šta donosi',
    '',
    list(release.changes.sh),
    '',
    '## Instalacija',
    '',
    `Preuzmi \`${installer}\` i pokreni ga. Instalira se samo za tvog korisnika i ne traži administratorska prava. U \`SHA256SUMS.txt\` je njegov SHA-256, za proveru preuzetog fajla.`,
    '',
    // The dialog's buttons are named in the language Windows is set to, so they're described, with the English names.
    ...unsigned(
      'Instaler još nije potpisan, pa Windows SmartScreen prvi put upozori na njega. Klikni na link ispod teksta upozorenja („More info” na engleskom Windowsu), pa na dugme koje se pojavi dole desno („Run anyway”).',
    ),
    signingPolicySh,
  ].join('\n');
}
