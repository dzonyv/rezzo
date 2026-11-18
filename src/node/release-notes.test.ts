import { describe, expect, it } from 'vitest';
import { CHANGELOG } from '../shared/changelog.ts';
import { releaseNotes } from './release-notes.ts';

describe('release notes', () => {
  it('says what the version brings and how to install it, in both languages', () => {
    const release = CHANGELOG[0]!;
    const notes = releaseNotes(release.version, `Rezzo-Setup-${release.version}.exe`);
    const [en, sh] = notes.split('## Šta donosi');
    expect(en).toContain(`- ${release.changes.en[0]}`);
    expect(en).toContain(`Download \`Rezzo-Setup-${release.version}.exe\``);
    expect(en).toContain('SHA256SUMS.txt');
    expect(sh).toContain(`- ${release.changes.sh[0]}`);
    expect(sh).toContain(`Preuzmi \`Rezzo-Setup-${release.version}.exe\``);
    expect(sh).toContain('SHA256SUMS.txt');
  });

  it("refuses a version the changelog doesn't have", () => {
    expect(() => releaseNotes('99.0.0', 'x.exe')).toThrow(/No changelog entry for 99\.0\.0/);
  });
});
