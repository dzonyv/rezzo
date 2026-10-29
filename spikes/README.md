# Phase 0 spikes

Throwaway experiments that answer one question each before we build the app: does this part work well enough on our footage and our hardware? The results and the decisions go into `REPORT.md`.

- `whisper/` — 0a, transcription of Serbian, Croatian and Bosnian with word timing
- `faces/` — 0b, faces and lip movement (MediaPipe)
- `export/` — 0c, WebGL rendering and GPU export from Electron

## Setup

Requires Node 24.

```
cd spikes
npm install
npm run fetch-tools          # or e.g. `npm run fetch-tools -- ffmpeg models`
npm test
```

`fetch-tools` downloads everything listed in `tools.json` into `vendor/` and `models/` at the repo root (both ignored by git) and checks each file's size and checksum.

## 0c: export

```
npm run make-source          # synthetic test source + working files
npm run lab                  # preview, seek and export measurements (opens a window)
npm run lab -- --run=export --only=A-yuv-nvenc
npm run verify               # checks the exported files, prints a table
```

Raw numbers land in `<media>/export/results.json` and `verify.json`.

## Phase 1 checks: IPC and working files

```
npm run ipc:working          # converts the real clips to working files, times it
npm run ipc:lab              # sandboxed renderer -> utility process -> FFmpeg (opens a window)
npm run ipc:lab -- --link=direct --run=export
```

`--link=relay` (default) posts frames from a Web Worker, `--link=direct` from the page itself. Results land in `<media>/ipc/`.

## 0a: transcription

```
npm run whisper:run          # every clip x model x language (resumable)
npm run whisper:speed        # speed per model, with and without DTW
node whisper/precheck.ts     # script, word counts, loops (no ground truth needed)
npm run whisper:review       # drafts + Audacity labels for hand correction
npm run whisper:metrics -- --clips <id>,<id>   # score corrected clips only
```

Corrected transcripts and labels live in `<media>/whisper/review/`, with instructions for whoever corrects them in `UPUTSTVO.txt`.

## 0b: faces and lips

```
npm run faces:lab            # MediaPipe on every clip, writes <clip>.json and <clip>.debug.mp4
node faces/summarize.ts      # detection rates, sizes, timings, cuts
npm run faces:speakers       # active-speaker accuracy against speaker labels
```

## Footage

Real clips go in `D:\RezzoMedia\phase0\` (or wherever `REZZO_MEDIA` points), never in the repo. Transcripts, frames and debug videos made from them are written there too.
