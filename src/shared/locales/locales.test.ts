import { describe, expect, it } from 'vitest';
import en from './en.json';
import sh from './sh.json';

type Tree = { [key: string]: string | Tree };

/** Flattens nested keys to "a.b.c" -> value. */
function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of flatten(value, path)) out.set(k, v);
  }
  return out;
}

const placeholders = (s: string) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();

describe('locales', () => {
  const english = flatten(en);
  const bcs = flatten(sh);

  it('have the same keys', () => {
    expect([...bcs.keys()].sort()).toEqual([...english.keys()].sort());
  });

  it('have no empty strings', () => {
    for (const [key, value] of [...english, ...bcs]) expect(value.trim(), key).not.toBe('');
  });

  it('use the same placeholders', () => {
    for (const [key, value] of english) expect(placeholders(bcs.get(key) ?? ''), key).toEqual(placeholders(value));
  });

  it('BCS text is Latin script', () => {
    for (const [key, value] of bcs) expect(value, key).not.toMatch(/[Ѐ-ӿ]/);
  });
});
