import { describe, expect, it } from 'vitest';
import { CHANGELOG } from '../shared/changelog.ts';
import { releaseNotes } from './release-notes.ts';

const release = CHANGELOG[0]!;
const installer = `Rezzo-Setup-${release.version}.exe`;

/** The English and the Serbian part. */
function parts(notes: string): [string, string] {
  const split = notes.split('## Šta donosi');
  expect(split, 'the Serbian part starts with "## Šta donosi"').toHaveLength(2);
  return split as [string, string];
}

describe('release notes', () => {
  it('says what the version brings and how to install it, in both languages', () => {
    const [en, sh] = parts(releaseNotes(release.version, { installer, signed: false }));
    expect(en).toContain(`- ${release.changes.en[0]}`);
    expect(en).toContain(`Download \`${installer}\``);
    expect(en).toContain('SHA256SUMS.txt');
    expect(sh).toContain(`- ${release.changes.sh[0]}`);
    expect(sh).toContain(`Preuzmi \`${installer}\``);
    expect(sh).toContain('SHA256SUMS.txt');
  });

  it('says what to do about SmartScreen while the installer is unsigned: in Serbian, and in English through the README', () => {
    const [en, sh] = parts(releaseNotes(release.version, { installer, signed: false }));
    expect(en).toContain('https://github.com/dzonyv/rezzo#download');
    expect(en).not.toContain('Run anyway');
    expect(sh).toContain('SmartScreen');
    expect(sh).toContain('„Run anyway”');
  });

  it("doesn't mention SmartScreen once the installer is signed", () => {
    const notes = releaseNotes(release.version, { installer, signed: true });
    expect(notes).not.toContain('SmartScreen');
    expect(notes).toContain('SHA256SUMS.txt');
  });

  it("refuses a version the changelog doesn't have", () => {
    expect(() => releaseNotes('99.0.0', { installer: 'x.exe', signed: false })).toThrow(/No changelog entry for 99\.0\.0/);
  });
});
