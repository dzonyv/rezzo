// Makes the pictures shown when someone shares a link to the site
// (public/og-sr.png and public/og-en.png, 1200×630). It draws them in Edge
// through playwright-core, which the app already uses for its tests:
//
//   npm run make-og
//
// Run `npm run make-assets` first; it uses the fonts and the clip picture from there.
// The results are committed, so the site build doesn't need this.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const site = new URL('../', import.meta.url);
const font = async (name) => (await readFile(new URL(`public/fonts/${name}.woff2`, site))).toString('base64');
const clip = (await readFile(new URL('src/assets/clip-vertical.png', site))).toString('base64');
const [onest, unbounded, mono] = await Promise.all([font('onest'), font('unbounded'), font('dm-mono')]);
// The app icon, drawn dark on the yellow.
const icon = (await readFile(new URL('public/favicon.svg', site), 'utf8'))
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace('fill="#ffd400"', 'fill="#12110e"')
  .replaceAll('stroke="#12110e"', 'stroke="#ffd400"');

const cards = {
  sr: { kicker: 'Besplatno · open source · Windows', title: 'Besplatan program za klipove iz podkasta', none: 'Bez watermarka · bez pretplate' },
  en: { kicker: 'Free · open source · Windows', title: 'A free app for clips from podcasts', none: 'No watermark · no subscription' },
};

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const [lang, card] of Object.entries(cards)) {
  await page.setContent(html(card));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL(`public/og-${lang}.png`, site)) });
  console.log(`public/og-${lang}.png`);
}
await browser.close();

function html({ kicker, title, none }) {
  return `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Onest;src:url(data:font/woff2;base64,${onest})}
@font-face{font-family:Unbounded;src:url(data:font/woff2;base64,${unbounded});font-weight:800}
@font-face{font-family:'DM Mono';src:url(data:font/woff2;base64,${mono})}
*{box-sizing:border-box}
body{margin:0;width:1200px;height:630px;background:#12110e;color:#171405;font-family:Onest;overflow:hidden}
.top,.bottom{position:absolute;background:#ffd400}
.top{left:40px;right:40px;top:40px;height:430px;border-radius:28px 28px 0 0;clip-path:polygon(0 0,100% 0,100% 82%,0 100%);padding:52px 56px}
.bottom{left:62px;right:18px;top:426px;bottom:40px;border-radius:0 0 28px 28px;clip-path:polygon(0 70px,100% 0,100% 100%,0 100%);padding:84px 56px 0;font-family:Unbounded;font-weight:800;font-size:28px}
.kicker{font-family:'DM Mono';font-size:20px;text-transform:uppercase;letter-spacing:.06em;margin:0 0 22px}
h1{font-family:Unbounded;font-weight:800;font-size:62px;line-height:1.04;letter-spacing:-.02em;margin:0;max-width:760px}
.bottom{display:flex;justify-content:space-between;align-items:center;padding-bottom:0}
.brand{display:flex;align-items:center;gap:14px;font-size:30px}
.brand svg{width:48px;height:48px}
.phone{position:absolute;right:92px;top:68px;width:212px;height:377px;border:8px solid #12110e;border-radius:26px;overflow:hidden;background:#12110e}
.phone img{width:100%;height:100%;object-fit:cover;display:block}
</style>
<div class="top"><p class="kicker">${kicker}</p><h1>${title}</h1></div>
<div class="bottom"><span>${none}</span><span class="brand">${icon}REZZO</span></div>
<div class="phone"><img src="data:image/png;base64,${clip}" alt=""></div>`;
}
