import { describe, expect, it } from 'vitest';
import { CHANGELOG } from '../shared/changelog.ts';
import { releaseNotes } from './release-notes.ts';

describe('release notes', () => {
  it('lists the changes in both languages, with the installer and where to read how to install it', () => {
    const release = CHANGELOG[0]!;
    const notes = releaseNotes(release.version, `Rezzo-Setup-${release.version}.exe`);
    expect(notes).toContain(`- ${release.changes.en[0]}`);
    expect(notes).toContain(`- ${release.changes.sh[0]}`);
    expect(notes).toContain(`\`Rezzo-Setup-${release.version}.exe\``);
    expect(notes).toContain('https://github.com/dzonyv/rezzo#download');
    expect(notes).toContain('SHA256SUMS.txt');
  });

  it("refuses a version the changelog doesn't have", () => {
    expect(() => releaseNotes('99.0.0', 'x.exe')).toThrow(/No changelog entry for 99\.0\.0/);
  });
});
