# Rezzo

Rezzo is a desktop app for cutting vertical clips out of podcasts and talk shows.

I post podcast clips on social media, and the work is the same every time: find a good moment, crop a wide shot down to 9:16, keep whoever is talking in frame, add captions. The apps that handle this well either stamp a watermark on the video or put the useful parts behind a monthly subscription. Rezzo does the same job for free, and every feature is in the free version because there is no other version.

It's built for Serbian (Balkan) content first, since that's what I work with. Other languages should work too.

## Where it stands

There's no release to download yet, but you can build the installer yourself (see below). Phase 0 checked that the hard parts (transcription, face tracking, GPU export) work on an ordinary PC before I built the app around them. What we found is in [spikes/REPORT.md](spikes/REPORT.md).

Phase 1 is done, so the basic job works from start to finish. You import an episode, transcribe it, and search the transcript while the video plays. Select a few sentences and they become a clip. You frame it for 9:16 in any of the three layouts, switching between them partway through if you like, and export it as a 1080×1920 MP4. The full plan is in [ROADMAP.md](ROADMAP.md).

Captions are in progress. The groundwork is done: you can fix the transcript where Whisper got it wrong, one word after another without touching the mouse, and nudge word timings against the waveform. Words it always gets wrong (it writes "futbal" every single time) go on a replacement list, and every new transcript gets fixed automatically. Drawing the captions on the video comes next.

## Running it from source

You need Windows and Node 24.

```
npm install
npm run fetch-tools
npm run dev
```

`fetch-tools` puts FFmpeg in `vendor/`. The first time you transcribe, the app downloads whisper.cpp and the speech model (about 1.3 GB with an NVIDIA card) into `%LOCALAPPDATA%\Rezzo`. `npm run check` runs the linter, the type checker and the unit tests; `npm run test:e2e` builds the app and drives it with Playwright.

To build the installer, run this after `fetch-tools`:

```
npm run dist
```

That puts `Rezzo-Setup-0.1.0.exe` (about 180 MB) in `release/`. It installs for your user only and doesn't need administrator rights. The installer isn't signed, so Windows SmartScreen will warn you the first time. Click "More info", then "Run anyway". Uninstalling leaves the downloaded speech model in `%LOCALAPPDATA%\Rezzo`, so a reinstall doesn't download it again. Delete that folder if you want the space back.

## What it will do

- Transcribe the whole episode with timing for every word, so you can search it and pick a clip by selecting text.
- Frame the clip for 9:16 in one of three ways: follow the person talking, stack two people on top of each other, or show the full shot over a blurred copy of itself. You can switch between them in the middle of a clip.
- Captions that appear word by word and highlight the word being spoken.
- Images, animations, green screen and effects on a timeline.
- Follow the speaker automatically, mostly from camera cuts and the audio, with a quick click to fix it when it guesses wrong.
- Export at 1080×1920 using the graphics card when there is one. The preview and the export use the same renderer, so the file looks like what you saw while editing.

Transcripts are always in Latin script. If Cyrillic comes out of the speech model, it gets converted.

## Under the hood

Electron, React and TypeScript. FFmpeg comes bundled with the app, whisper.cpp handles transcription and MediaPipe finds faces. Windows only for now; macOS and Linux will come later.

## Contributing

Issues and ideas are welcome. Project rules are in [CLAUDE.md](CLAUDE.md). The most important one: never commit podcast or show footage. Anything used for testing has to be openly licensed.

## License

[GPL-3.0](LICENSE)
