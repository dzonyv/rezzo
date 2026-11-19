/**
 * Where Rezzo's website is published. The site's build (site/site.config.mjs)
 * and the release text both read it from here, so moving to a domain of its
 * own means changing these two lines. README.md has the same links written
 * out; change them there too.
 */
export const websiteOrigin = 'https://dzonyv.github.io';
/** The path the site lives under, with a slash at both ends ('/' on its own domain). */
export const websiteBase = '/rezzo/';

/** The full address of a page on the website, e.g. websiteUrl('en/potpisivanje/'). */
export function websiteUrl(path = ''): string {
  return new URL(websiteBase + path.replace(/^\//, ''), websiteOrigin).href;
}
