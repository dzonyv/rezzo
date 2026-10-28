# Rezzo

Rezzo is a free, open-source desktop app for turning podcast and talk-show footage into vertical short-form clips (9:16). No watermark, no subscription, no features locked behind a paywall.

> **Status:** early development (Phase 0 — technical spikes). Nothing is usable yet. See [ROADMAP.md](ROADMAP.md).

## What it will do

- Import a full episode and get a searchable, word-level transcript (Serbian, Croatian, Bosnian and more), always in Latin script.
- Pick a clip by selecting text in the transcript.
- Frame it for 9:16 with three layouts that can change during the clip:
  - **Follow** — the frame follows the active speaker.
  - **Split** — two speakers stacked one above the other.
  - **Full frame** — the whole shot over a blurred background.
- Word-by-word animated captions with ready-made and custom styles.
- Layers on a multi-track timeline with keyframes: images with animations, green screen, transparent videos, Lottie animations, effects.
- Automatic speaker tracking: camera cut detection, active speaker from faces, lips and audio, smooth reframing.
- Export 1080×1920 with GPU encoding (NVENC) and a software fallback. The export is rendered by the same WebGL renderer as the preview, so what you see is what you get.

## Tech stack

- Electron + React + TypeScript
- FFmpeg (bundled) for decoding, cutting, audio and muxing
- whisper.cpp (CUDA) for transcription with word timestamps
- MediaPipe for face and lip detection (no Python)
- WebGL renderer shared by preview and export

Windows first; macOS and Linux later.

## Contributing

The project is in its earliest stage. Issues and ideas are welcome. Please read [CLAUDE.md](CLAUDE.md) for project rules — in particular: **never commit podcast or show footage**. Tests use only openly licensed material.

## License

[GPL-3.0](LICENSE)
