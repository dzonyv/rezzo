// Makes the pictures shown when someone shares a link to the site
// (public/og-sr.png and public/og-en.png, 1200×630). It draws them in Edge
// through playwright-core, which the app already uses for its tests. The
// phone in them is the drawn clip from the built home page, held still:
//
//   npm run build && npm run make-og
//
// The results are committed, so the site build doesn't need this.
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { base as configBase } from '../site.config.mjs';

const site = new URL('../', import.meta.url);
const base = configBase.endsWith('/') ? configBase : `${configBase}/`;
const dist = fileURLToPath(new URL('dist/', site));
const font = async (name) => (await readFile(new URL(`public/fonts/${name}.woff2`, site))).toString('base64');
const [onest, unbounded, mono] = await Promise.all([font('onest'), font('unbounded'), font('dm-mono')]);
// The app icon, drawn dark on the yellow.
const icon = (await readFile(new URL('public/favicon.svg', site), 'utf8'))
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace('fill="#ffd400"', 'fill="#12110e"')
  .replaceAll('stroke="#12110e"', 'stroke="#ffd400"');

const cards = {
  sr: { page: base, kicker: 'Besplatno · open source · Windows', title: 'Besplatan program za klipove iz podkasta', none: 'Bez watermarka · bez pretplate' },
  en: { page: `${base}en/`, kicker: 'Free · open source · Windows', title: 'A free app for clips from podcasts', none: 'No watermark · no subscription' },
};
const types = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

const browser = await chromium.launch({ channel: 'msedge' });
// Reduced motion holds the drawn clip on its first moment.
const context = await browser.newContext({ reducedMotion: 'reduce', deviceScaleFactor: 2 });
// Serve dist/ under a made-up host, at the base path, the way GitHub Pages serves it.
await context.route('http://site.test/**', async (route) => {
  let path = new URL(route.request().url()).pathname.slice(base.length);
  if (path === '' || path.endsWith('/')) path += 'index.html';
  try {
    const body = await readFile(join(dist, decodeURIComponent(path)));
    await route.fulfill({ body, contentType: types[extname(path)] ?? 'application/octet-stream' });
  } catch {
    await route.fulfill({ status: 404 });
  }
});

const page = await context.newPage();
for (const [lang, card] of Object.entries(cards)) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://site.test${card.page}`);
  await page.evaluate(() => document.fonts.ready);
  const phone = (await page.locator('.phone-frame').screenshot()).toString('base64');

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(html(card, phone));
  await page.evaluate(() => document.fonts.ready);
  const out = fileURLToPath(new URL(`public/og-${lang}.png`, site));
  // Back to 1×: the card is 1200×630, the size social sites ask for.
  await page.screenshot({ path: out, scale: 'css' });
  console.log(`public/og-${lang}.png`);
}
await browser.close();

function html({ kicker, title, none }, phone) {
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Onest;src:url(data:font/woff2;base64,${onest})}
@font-face{font-family:Unbounded;src:url(data:font/woff2;base64,${unbounded});font-weight:800}
@font-face{font-family:'DM Mono';src:url(data:font/woff2;base64,${mono})}
*{box-sizing:border-box}
body{margin:0;width:1200px;height:630px;background:#12110e;color:#171405;font-family:Onest;overflow:hidden}
.top,.bottom{position:absolute;background:#ffd400}
.top{left:40px;right:40px;top:40px;height:430px;border-radius:28px 28px 0 0;clip-path:polygon(0 0,100% 0,100% 82%,0 100%);padding:52px 56px}
.bottom{left:62px;right:18px;top:426px;bottom:40px;border-radius:0 0 28px 28px;clip-path:polygon(0 70px,100% 0,100% 100%,0 100%);padding:84px 56px 0;font-family:Unbounded;font-weight:800;font-size:28px;display:flex;justify-content:space-between;align-items:center}
.kicker{font-family:'DM Mono';font-size:20px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 22px}
h1{font-family:Unbounded;font-weight:800;font-size:62px;line-height:1.04;letter-spacing:-.02em;margin:0;max-width:740px}
.brand{display:flex;align-items:center;gap:14px;font-size:30px}
.brand svg{width:48px;height:48px}
.phone{position:absolute;right:96px;top:62px;width:220px;display:block}
</style>
<div class="top"><p class="kicker">${kicker}</p><h1>${title}</h1></div>
<div class="bottom"><span>${none}</span><span class="brand">${icon}REZZO</span></div>
<img class="phone" src="data:image/png;base64,${phone}" alt="">`;
}
