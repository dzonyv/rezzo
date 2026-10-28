# Rezzo

Rezzo is a desktop app for cutting vertical clips out of podcasts and talk shows.

I post podcast clips on social media, and the work is the same every time: find a good moment, crop a wide shot down to 9:16, keep whoever is talking in frame, add captions. The apps that handle this well either stamp a watermark on the video or put the useful parts behind a monthly subscription. Rezzo does the same job for free, and every feature is in the free version because there is no other version.

It's built for Serbian (Balkan) content first, since that's what I work with. Other languages should work too.

## Where it stands

There's nothing to download yet. Phase 0 is done: we checked that the hard parts (transcription, face tracking, GPU export) work on an ordinary PC before building the app around them, and wrote down what we found in [spikes/REPORT.md](spikes/REPORT.md). Next up is Phase 1, the first version you can actually use. The full plan is in [ROADMAP.md](ROADMAP.md).

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
