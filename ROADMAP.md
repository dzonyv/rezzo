# Roadmap

Each phase is developed on its own branch and merged through a pull request that includes testing instructions.

## Phase 0 — Risk check (spikes) ✓

Prove the riskiest parts work before building the app. Done; results and decisions are in [spikes/REPORT.md](spikes/REPORT.md).

- **0a — Transcription:** whisper.cpp on Serbian, Croatian and Bosnian: accuracy, script (Cyrillic → Latin), word timestamp accuracy, speed on a GTX 1660.
- **0b — Faces and lips:** MediaPipe face detection and mouth movement on 3–4 kinds of footage (wide shot, multi-camera with cuts, small faces, segments without faces).
- **0c — GPU export from Electron:** WebGL-rendered frames encoded with NVENC (software fallback), frame-accurate, preview identical to export.

## Phase 1 — Foundation ✓

Built in three parts, each with its own pull request: 1a (app skeleton, projects, import, transcription, transcript and search), 1b (choosing a clip, framing, preview) and 1c (export and the installer).

- Import an episode; transcript with search.
- Select a clip by highlighting transcript text.
- Manual 9:16 framing with all three layouts (Follow, Split, Full frame with blurred background); layout can change during the clip.
- Export 1080×1920.
- Save/open project; undo/redo.

## Phase 2 — Captions

- Word-by-word captions with the spoken word highlighted.
- Built-in and custom styles.
- Editing caption text and timing, fast enough to fix one word in five.
- A user-editable replacement list for words Whisper always gets wrong (e.g. "futbal" → "fudbal"), applied without losing word timings.
- Tune word timings (Whisper's DTW times run slightly late).

## Phase 3 — Layers

- Images with animations: pop, slide, zoom, bounce, shake, Ken Burns.
- Green screen with adjustable keying.
- Videos with transparent background.
- Lottie animations.
- Effects library.
- Multi-layer timeline.

## Phase 4 — Speaker tracking

- Short spike first: telling voices apart from the audio (speaker diarization), without Python.
- Camera cut detection.
- People found with pose detection, faces and lips on close shots.
- Active speaker mainly from camera cuts and audio; lips only help on close shots (Phase 0 showed they aren't reliable on their own).
- Smooth reframing.
- Automatic split layout.
- Manual corrections by clicking: a main tool for single-camera wide shots, not just a fallback.

## Phase 5 — Later

- AI suggestions for interesting moments.
- Silence removal.
- Music.
- macOS and Linux.
