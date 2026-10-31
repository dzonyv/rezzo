/**
 * Renders resources/icon.svg to resources/icon.png (512×512), which
 * electron-builder turns into the Windows .ico. Run it after changing the
 * SVG and commit both:
 *
 *   npx electron scripts/make-icon.mjs
 *
 * Plain JavaScript because it runs in Electron, which draws the SVG the way
 * Chromium does.
 */
import { app, BrowserWindow } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SIZE = 512;
const resources = path.join(import.meta.dirname, '..', 'resources');

app.whenReady().then(async () => {
  try {
    const svg = await readFile(path.join(resources, 'icon.svg'), 'utf8');
    const win = new BrowserWindow({ show: false });
    await win.loadURL('about:blank');
    const dataUrl = await win.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = ${SIZE};
          canvas.getContext('2d').drawImage(img, 0, 0, ${SIZE}, ${SIZE});
          resolve(canvas.toDataURL('image/png'));
        };
        img.onerror = () => reject(new Error('the SVG did not load'));
        img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
      })
    `);
    await writeFile(path.join(resources, 'icon.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('resources/icon.png written');
    app.exit(0);
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
});
