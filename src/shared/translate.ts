/**
 * Plain key lookup in the locale files, for the main process (dialog titles,
 * file type names). The renderer uses i18next with the same files.
 */
import en from './locales/en.json';
import sh from './locales/sh.json';
import type { UiLanguage } from './settings.ts';

type Tree = { [key: string]: string | Tree };
const LOCALES: Record<UiLanguage, Tree> = { en, sh };

function lookup(tree: Tree, key: string): string | undefined {
  let node: string | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export function translate(language: UiLanguage, key: string, vars: Record<string, string | number> = {}): string {
  const text = lookup(LOCALES[language], key) ?? lookup(LOCALES.en, key) ?? key;
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}
