import { describe, expect, it } from 'vitest';
import { defaultUiLanguage } from './settings.ts';

describe('defaultUiLanguage', () => {
  it('starts in Serbian on Serbian, Croatian, Bosnian and Montenegrin systems', () => {
    for (const locale of ['sr', 'sr-Latn-RS', 'sr_RS', 'hr', 'hr-HR', 'bs-BA', 'cnr', 'sh']) expect(defaultUiLanguage(locale)).toBe('sh');
  });

  it('starts in English everywhere else', () => {
    for (const locale of ['en-US', 'de-DE', 'sl-SI', 'mk-MK', 'srb', '']) expect(defaultUiLanguage(locale)).toBe('en');
  });
});
