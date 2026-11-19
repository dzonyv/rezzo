// Where the site is published. Astro, the budget check and the share-picture
// script all read it from here; the address itself lives in
// src/shared/website.ts, which the app's release text reads too.
export { websiteBase as base, websiteOrigin as site } from '../src/shared/website.ts';
