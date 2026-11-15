# Promo video

A 30-second vertical promo for Rezzo (1080×1920, 30 fps), in Serbian and in English, made with [Remotion](https://www.remotion.dev). Nothing in this folder ships with the app, and the app's `package.json` doesn't depend on it.

## Making the video

```bash
cd demo
npm install
npm run prepare-assets
npm run render
```

`prepare-assets` fills `public/`. It copies the icon, the README screenshots, three fonts and a few sound effects from the app, and cuts 16 seconds of *Tears of Steel* (0:24 to 0:40) into `public/footage.mp4`. FFmpeg reads only that part straight from Blender's server, so you don't need the whole 372 MB film. If you have it already, pass its path: `npm run prepare-assets -- D:\media\tears_of_steel_720p.mov`. FFmpeg comes from `vendor/` if you've run `npm run fetch-tools` in the repo, and from your PATH if you haven't.

`npm run render` writes `out/rezzo-promo-sh.mp4` and `npm run render:en` writes the English one. To change timing, `npm run studio` opens Remotion's editor in the browser.

`public/` and `out/` stay out of git.

## What's where

- `src/Promo.tsx`: the five scenes, when each starts, and where the sound effects go.
- `src/scenes/`: one file per scene. `Footage.tsx` has the crop positions for the three layouts, keyed to the film's time.
- `src/copy.ts`: all the text on screen, in both languages. The layout names are the same as on the app's buttons.
- `src/captions.ts`: the caption text, our Serbian translation of the film's English subtitles.

Rezzo didn't make this video. The captions and the cropping are animated by hand to look like what it exports.

## Licenses

- *Tears of Steel* is (CC) Blender Foundation | mango.blender.org, under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The credit shows during the footage and at the end. The film's soundtrack is CC BY-ND, and putting it under new pictures counts as adapting it, so the promo has none of the film's sound.
- The captions are our Serbian translation of the film's English subtitles (`TOS-en.srt` from download.blender.org), shared like the film under CC BY 3.0. The film doesn't have Serbian subtitles.
- The sound effects are CC0, from the app's own library (see `resources/sounds/CREDITS.md`).
- The fonts (Unbounded, Onest and Montserrat) are under the SIL Open Font License and are copied from the app.
- Remotion has its own license: free for individuals and for companies of up to three people, paid above that. See [remotion.dev/license](https://www.remotion.dev/license). It only matters to whoever renders the video, because no Remotion code ends up in the app.
