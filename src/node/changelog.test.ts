import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHANGELOG } from '../shared/changelog.ts';
import { UI_LANGUAGES } from '../shared/settings.ts';

describe('changelog', () => {
  it('starts with the version in package.json', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(CHANGELOG[0]?.version).toBe(version);
  });

  it('lists each version once, newest first', () => {
    const versions = CHANGELOG.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    const order = (v: string) => v.split('.').map(Number);
    for (let i = 1; i < versions.length; i++) {
      const [a, b] = [order(versions[i - 1]!), order(versions[i]!)];
      const newer = a.findIndex((n, j) => n !== b[j]);
      expect(a[newer]!).toBeGreaterThan(b[newer]!);
    }
  });

  it('says every change in every interface language', () => {
    for (const release of CHANGELOG) {
      const counts = UI_LANGUAGES.map((lng) => release.changes[lng].length);
      expect(counts[0]).toBeGreaterThan(0);
      expect(new Set(counts).size).toBe(1);
      for (const lng of UI_LANGUAGES) for (const line of release.changes[lng]) expect(line.trim()).not.toBe('');
    }
  });
});
