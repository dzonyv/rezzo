export type Lang = 'sr' | 'en';
export const langs: Lang[] = ['sr', 'en'];

/** The value for `lang` and `hreflang`. The app calls Serbian `sh`; on the web it's sr-Latn. */
export const htmlLang: Record<Lang, string> = { sr: 'sr-Latn', en: 'en' };
export const ogLocale: Record<Lang, string> = { sr: 'sr_RS', en: 'en_US' };

/** Every page, by the path it has in Serbian. English pages have the same path under /en/. */
export type Page = '' | 'preuzmi' | 'uputstvo' | 'izmene' | 'licence' | 'potpisivanje' | '404';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

/** A link to a page of the site, in a language, with the base path the site is served under. */
export function href(lang: Lang, page: Page, hash = ''): string {
  const prefix = lang === 'en' ? '/en' : '';
  const path = page === '' ? '/' : `/${page}/`;
  return `${base}${prefix}${path}${hash ? `#${hash}` : ''}`;
}

/** A file from public/, with the base path. */
export function asset(path: string): string {
  return `${base}/${path.replace(/^\//, '')}`;
}

/** The full address of a page, for canonical links, hreflang, Open Graph and the sitemap. */
export function absolute(path: string): string {
  return new URL(path, import.meta.env.SITE).href;
}
