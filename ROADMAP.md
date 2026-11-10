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

## Phase 2 — Captions ✓

Built in two parts: 2a (correcting the transcript, word timing, the replacement list) and 2b (captions on the video, styles, fonts).

- Word-by-word captions with the spoken word highlighted.
- Built-in and custom styles.
- Editing caption text and timing, fast enough to fix one word in five.
- A user-editable replacement list for words Whisper always gets wrong (e.g. "futbal" → "fudbal"), applied without losing word timings.
- Tune word timings (Whisper's DTW times run slightly late).

## Phase 3 — Layers ✓

Built in three parts: 3a (layers over the picture, the multi-layer timeline, images with animations), 3b (video layers and green screen) and 3c (Lottie and effects).

- Images with animations: pop, slide, zoom, bounce, shake, Ken Burns.
- Green screen with adjustable keying.
- Videos with transparent background.
- Lottie animations.
- Effects library.
- Multi-layer timeline.

## Phase 4 — Speaker tracking ✓

Built in three parts: 4a (clip analysis: voices, camera cuts, people), 4b (who talks, corrected by clicking) and 4c (automatic framing).

- Short spike first: telling voices apart from the audio (speaker diarization), without Python.
- Camera cut detection.
- People found with pose detection, faces and lips on close shots.
- Active speaker mainly from camera cuts and audio; lips only help on close shots (Phase 0 showed they aren't reliable on their own).
- Smooth reframing.
- Automatic split layout.
- Manual corrections by clicking: a main tool for single-camera wide shots, not just a fallback.

## Phase 5 — Later

- Silence removal, and cutting words out of a clip ✓
- Sound, before the first release: sound effects (a click, a camera shutter, a whoosh…) and music as audio layers on the clip timeline, with volume and fades. A small library of freely licensed effects comes with the app, and your own files work too.
- Fixes from the audit of 2026-11-08, before the first release (details below).
- AI suggestions for interesting moments.
- macOS and Linux.

## Fixes from the audit of 2026-11-08

An outside review of `f6cf25e` found sixteen bugs. Each one was checked against the code and all of them are real. They're grouped into four pull requests, in the order below. Each PR adds tests for the races it fixes; the current unit and end-to-end tests don't exercise any of these orderings.

### Saving and opening ✓

- A save that finishes after another project was opened gives that project the first one's file, and the next Save overwrites it (`project/actions.ts` `save()`). Saves need to know which open project they belong to, and two saves shouldn't run at once.
- Opening the project that's already open, and choosing Save in the unsaved-changes prompt, loads the file as it was read *before* the save. The new work disappears from the screen and the old version counts as saved (`openProject()` reads the file before `settleUnsaved()`).
- Closing the window while a word is being corrected can skip the save prompt and lose that word: `settleUnsaved()` doesn't make the word editor hand its text over first, the way `save()` does.
- A recovery copy that fails to write isn't tried again until the next edit (`useProjectChrome.ts`: `written` is set before the write succeeds, and the failure is ignored). A persistent failure should be shown.
- Two settings changes at the same time can lose one of them (`main/settings.ts`): read, merge and write have to happen one after another.
- Changing a layer's missing file to the same file at its new place keeps the old path, for images, videos, Lottie and sound (`replaceImage/Video/Lottie/Sound` in `project/layers.ts`). Adding a layer already updates the path; replacing should too.

### Preview playback ✓

- Trimming a clip past its working file and quickly back again leaves the preview stuck on "preparing" with Play disabled (`ClipPreview.tsx`: reusing the player doesn't set the status back to ready).
- Changing the start or end of a clip while it plays keeps playing the old range until the loop comes round (`clip-player.ts` `setRange()` restarts only for changed skips).
- The loop goes back to the start about a frame and a half early and cuts the last ~50 ms of sound. Preview only; exported files aren't affected.

### Cancelling long jobs ✓

- Cancelling an export while a video layer's working file is being made doesn't stop that conversion. FFmpeg keeps running and no other export can start until it finishes (`loadScene()` has no abort signal).
- Cancelling during the final frame count can still put the exported file in place, over the one chosen in the save dialog (`workers/media/export.ts`: `countFrames()` and the rename don't check the signal).
- Every time FFmpeg's input fills up, the export leaves two more listeners on the FFmpeg process until it exits (`Promise.race` of two `once()` calls).
- A worker call whose signal was already cancelled still runs, and its abort listener is never removed (`main/worker-host.ts` `callWorker()`).

This group also settles one cancellation rule for main, the page, the media worker and FFmpeg, so the next long job doesn't need its own.

### Main process hardening

- The page can read any file on disk by saving a project that points to it and opening it again: `project:save` and `project:open` accept any path from the page, and opening a project trusts every path in it. Only matters if someone already runs code in the page, but the page is sandboxed so that this exact thing stays impossible. Main should only open and save where the user chose in a dialog (or through recent projects), and check that a project's files exist and are media before handing out URLs for them.
- A small .lottie package can unpack to a thousand times its size (65 KB became 64 MB in the audit), synchronously in the main process (`main/lottie-file.ts`). Cap the unpacked size and do it off the main thread.
- A tool or model counts as installed as long as its `.installed` marker is there, even if the program or model next to it was deleted (antivirus does this). Transcription then fails every time instead of downloading again (`node/tools/download.ts` `isInstalled()`). Also stop a download that grows past its declared size.

### Also from the audit

- `npm audit` lists 16 moderate advisories, none high or critical, mostly in build tools. Go through them by whether the app actually uses the affected code; don't run `npm audit fix --force`.
- One lint warning: `react-hooks/incompatible-library` for `useVirtualizer()` in `TranscriptView.tsx`.
