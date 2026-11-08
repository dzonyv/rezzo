import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOUND_NAMES, soundFileName } from '../shared/sounds.ts';

const dir = path.join(__dirname, '..', '..', 'resources', 'sounds');

describe('the sound library', () => {
  it('has a file for every sound, and no file it does not list', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.ogg'));
    expect(files.sort()).toEqual(SOUND_NAMES.map(soundFileName).sort());
  });

  it('credits every sound, each under CC0', () => {
    const credits = readFileSync(path.join(dir, 'CREDITS.md'), 'utf8');
    for (const name of SOUND_NAMES) expect(credits).toContain(`| ${soundFileName(name)} |`);
    expect(credits).toContain('CC0 1.0');
  });
});
