# Third-party software in Rezzo

Rezzo itself is licensed under the GPL-3.0 (see `LICENSE`). The installer also contains the software below, each under its own license.

## FFmpeg

Rezzo uses FFmpeg to read video, cut it, and encode the exported clips. The installer includes the programs and libraries from this build:

- FFmpeg 9.0.2, BtbN build `ffmpeg-n9.0.2-36-g6882969ce9-win64-gpl-shared-9.0` (autobuild-2026-10-27-18-38)
- License: GPL-3.0-or-later. This is the "gpl" variant, which includes x264, x265 and other GPL libraries. It is built without `--enable-nonfree`. The full license text is in `tools/ffmpeg/<build>/LICENSE.txt`.
- Binaries: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-10-27-18-38
- Source code: FFmpeg at commit `6882969ce9` (https://github.com/FFmpeg/FFmpeg/commit/6882969ce9). The scripts that build it, along with the exact version of each library it includes, are at https://github.com/BtbN/FFmpeg-Builds.

## Electron and Chromium

The app runs on Electron 45.1.0 (MIT). Electron includes Chromium and its dependencies, whose licenses ship with the app in `LICENSES.chromium.html`.

## JavaScript libraries

These are compiled into the app's code:

| Library | Version | License |
|---|---|---|
| React, React DOM, scheduler | 19.3.1, 0.28.0 | MIT |
| i18next | 26.5.11 | MIT |
| react-i18next, html-parse-stringify | 17.1.9, 4.0.1 | MIT |
| Zustand, use-sync-external-store | 5.0.16, 1.7.0 | MIT |
| Immer | 11.2.9 | MIT |
| Zod | 4.6.7 | MIT |
| MP4Box.js | 2.5.0 | BSD-3-Clause |
| TanStack Virtual | 3.14.24 | MIT |

## Downloaded on first use, not included

The first time you transcribe, Rezzo downloads these into `%LOCALAPPDATA%\Rezzo\tools`. They aren't part of the installer.

- whisper.cpp v1.9.5 (MIT). The CUDA build includes NVIDIA's CUDA runtime, which is covered by the NVIDIA CUDA EULA. The CPU build includes OpenBLAS (BSD-3-Clause).
- The Whisper large-v3-turbo model, converted to ggml format (MIT).

Exact URLs and checksums for everything above are in `tools.json` in the source repository.
