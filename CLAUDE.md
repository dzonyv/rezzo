# Rezzo — project rules

Rezzo is a free, open-source (GPL-3.0) desktop app for making vertical short-form clips (9:16) from podcast and talk-show footage. A free alternative to CapCut: no watermark, nothing behind a subscription.

## Language

- Code, comments, commit messages and documentation: **English**.
- The UI is localized from day one: English and BCS (Bosnian/Croatian/Serbian, Latin script). No hard-coded UI strings.
- Conversation with the maintainer is in Serbian/BCS.

## Content and users

- Source material is in Serbian, Croatian and Bosnian.
- Footage varies: single wide shot, multi-camera with cuts, small faces, segments with no faces.
- Transcript text is **always Latin script**. Cyrillic output is transliterated to Latin (Љ→Lj, Њ→Nj, Џ→Dž, with correct casing).

## Hard rules

- **Never commit podcast or show footage**, nor transcripts or frames derived from it. Real footage lives outside the repo. Reports in the repo contain only aggregate numbers.
- Tests and fixtures use only openly licensed material (e.g. CC0, CC BY), with source and license recorded next to the fixture.
- Caption fonts must support č, ć, ž, š, đ and have a free license (e.g. OFL). Keep the license file with each bundled font.
- Bundled third-party binaries and models must be redistributable alongside a GPL-3.0 app (e.g. FFmpeg build without `--enable-nonfree`). Record each one's version, source and license.

## Target machine (reference)

Windows 11, NVIDIA GTX 1660 6 GB (Turing NVENC: H.264/HEVC, no AV1), Ryzen 7 5700X, 32 GB RAM, Node 24. Windows only for now; macOS and Linux later.

## Architecture decisions

- **Electron + React + TypeScript.**
- **FFmpeg is bundled** with the app (not expected on the system). It handles decoding, cutting, audio and muxing the final file. Export encodes with **NVENC**, falling back to a software encoder.
- **whisper.cpp with CUDA** for transcription with per-word timestamps. Language settings `sr`, `hr` and `bs` must be tested.
- **MediaPipe** (JS/WASM, in Electron) for faces and lip movement. **No Python.**
- **Everything is a layer on the timeline with keyframes:** video with framing, captions, images, video effects.
- **One WebGL renderer** draws both the preview and the export, so the export looks exactly like the preview.
- **Working file:** when a clip is selected, FFmpeg converts that segment once into a working file of a known format; everything downstream operates on it.
- **Framing layouts:** Follow (the speaker), Split (two speakers stacked), Full frame with blurred background. The layout can change during a clip.

## Workflow

- Each phase (see ROADMAP.md) is developed on its own branch and merged via a PR.
- Every PR description includes testing instructions for the maintainer and explains the key parts of the code (the maintainer knows TypeScript and React basics).
- Run `/code-review` before merging.
- Subagents are only for broad research and reviews, not for writing core code.
