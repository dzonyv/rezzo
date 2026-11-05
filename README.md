# Rezzo

Rezzo is a desktop app for cutting vertical clips out of podcasts and talk shows.

I post podcast clips on social media, and the work is the same every time: find a good moment, crop a wide shot down to 9:16, keep whoever is talking in frame, add captions. The apps that handle this well either stamp a watermark on the video or put the useful parts behind a monthly subscription. Rezzo does the same job for free, and every feature is in the free version because there is no other version.

It's built for Serbian (Balkan) content first, since that's what I work with. Other languages should work too.

## Where it stands

There's no release to download yet, but you can build the installer yourself (see below). Phase 0 checked that the hard parts (transcription, face tracking, GPU export) work on an ordinary PC before I built the app around them. What we found is in [spikes/REPORT.md](spikes/REPORT.md).

Phase 1 is done, so the basic job works from start to finish. You import an episode, transcribe it, and search the transcript while the video plays. Select a few sentences and they become a clip. You frame it for 9:16 in any of the three layouts, switching between them partway through if you like, and export it as a 1080×1920 MP4. The full plan is in [ROADMAP.md](ROADMAP.md).

Captions work too. Before drawing them you fix the transcript where Whisper got it wrong, one word after another without touching the mouse, and nudge word timings against the waveform. Words it always gets wrong (it writes "futbal" every single time) go on a replacement list, and every new transcript gets fixed automatically. Every new clip then gets captions that highlight the word being spoken. There are a few built-in styles, and you can change the font, colours, outline, size and how many words fit on a line, then save the result as your own style. Poppins Bold is the default because it's what I always use; Montserrat and Anton are also included, and you can add any TTF or OTF font you have. If a sentence breaks in an awkward spot, you can start a new caption page from any word.

Then there are layers. You can put an image over the picture for part of a clip, drag it into place in the preview, resize and turn it by its corners, and move or trim it on the timeline, where every layer gets its own row. It can pop, slide, zoom or bounce in, fade or slide out, and shake, pulse or slowly zoom in (Ken Burns) while it's on screen. Images stay where they are on your disk, the same as the episode: if you move one, Rezzo asks you where it went.

Videos go over the picture the same way. A WebM, ProRes or HEVC file with a transparent background stays transparent, and anything filmed on a green screen can have the green taken out: tick Green screen and click the colour to remove in the preview. A video layer can start partway into its file, loop, and has its own volume, mixed with the clip's sound in the preview and the export. Up to four videos can show at the same moment; that's what a GTX 1660 plays smoothly.

Lottie animations work like images too: add a .json or .lottie file, place it, and it plays from its first frame where the layer starts, faster or slower if you like, looping or stopping on its last frame. Animations that load their images from files next to them aren't supported; export them with the images inside.

Effects are layers as well. Each one changes everything under it on the timeline, so a new effect goes just below the captions and leaves them alone. There are camera moves (a zoom punch, shake, slow zoom), a white flash and fades to and from black, colour changes (brightness, contrast, saturation, temperature, black and white) and a few stylised ones (blur, vignette, glitch, film grain). Every effect has an intensity you can keyframe, so it can come in and go out as gradually as you want.

The app can also do the framing for you. After transcribing it tells the voices in the episode apart, and when you open a clip it looks for camera cuts and people. Press Auto frame and you get ordinary keyframes and layouts that you can change by hand. One person in a shot gets followed, a shot with nobody in it goes to full frame, and two people go to Split until the app knows who is who. On a wide shot it can't work that out alone, so turn on Show people and click whoever is talking. That click teaches it where the voice sits for the rest of the episode. If it gave a turn to the wrong voice, right-click the turn on the timeline and fix it. Lips turned out to be no use for this on real footage, so it goes by the audio and the camera cuts.

## Running it from source

You need Windows and Node 24.

```
npm install
npm run fetch-tools
npm run dev
```

`fetch-tools` puts FFmpeg, the voice tools and the pose and face models in `vendor/`. The first time you transcribe, the app downloads whisper.cpp and the speech model (about 1.3 GB with an NVIDIA card) into `%LOCALAPPDATA%\Rezzo`. `npm run check` runs the linter, the type checker and the unit tests; `npm run test:e2e` builds the app and drives it with Playwright.

To build the installer, run this after `fetch-tools`:

```
npm run dist
```

That puts `Rezzo-Setup-0.1.0.exe` (about 225 MB) in `release/`. It installs for your user only and doesn't need administrator rights. The installer isn't signed, so Windows SmartScreen will warn you the first time. Click "More info", then "Run anyway". Uninstalling leaves the downloaded speech model in `%LOCALAPPDATA%\Rezzo`, so a reinstall doesn't download it again. Delete that folder if you want the space back.

## What it does

- Transcribe the whole episode with timing for every word, so you can search it and pick a clip by selecting text.
- Frame the clip for 9:16 in one of three ways: follow the person talking, stack two people on top of each other, or show the full shot over a blurred copy of itself. You can switch between them in the middle of a clip.
- Captions that appear word by word and highlight the word being spoken.
- Images, animations, green screen and effects on a timeline.
- Follow the speaker automatically, mostly from camera cuts and the audio, with a quick click to fix it when it guesses wrong.
- Export at 1080×1920 using the graphics card when there is one. The preview and the export use the same renderer, so the file looks like what you saw while editing.

Transcripts are always in Latin script. If Cyrillic comes out of the speech model, it gets converted.

## Under the hood

Electron, React and TypeScript. FFmpeg comes bundled with the app, whisper.cpp handles transcription, MediaPipe finds people and faces, and sherpa-onnx tells voices apart. Windows only for now; macOS and Linux will come later.

## Contributing

Issues and ideas are welcome. Project rules are in [CLAUDE.md](CLAUDE.md). The most important one: never commit podcast or show footage. Anything used for testing has to be openly licensed.

## License

[GPL-3.0](LICENSE)
