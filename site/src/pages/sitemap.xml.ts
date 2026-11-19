import type { APIRoute } from 'astro';
import { absolute, href, htmlLang, langs, type Page } from '../i18n.ts';

const pages: Page[] = ['', 'preuzmi', 'uputstvo', 'izmene', 'licence'];

/** Every page in both languages, each listing its other language for search engines. */
export const GET: APIRoute = () => {
  const urls = pages.flatMap((page) =>
    langs.map((lang) => {
      const alternates = langs
        .map((l) => `<xhtml:link rel="alternate" hreflang="${htmlLang[l]}" href="${absolute(href(l, page))}"/>`)
        .concat(`<xhtml:link rel="alternate" hreflang="x-default" href="${absolute(href('sr', page))}"/>`)
        .join('');
      return `<url><loc>${absolute(href(lang, page))}</loc>${alternates}</url>`;
    }),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>\n`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
