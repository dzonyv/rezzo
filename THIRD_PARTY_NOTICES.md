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

## Fonts

Fonts for captions. Their licenses are in `licenses/fonts` in the installed app, and next to each font in `src/renderer/src/fonts` in the source repository. All three are under the SIL Open Font License 1.1 and come from the Google Fonts repository at commit `6c1dbe27dc` (https://github.com/google/fonts/tree/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/ofl).

| Font | Version | Files | Copyright |
|---|---|---|---|
| Poppins | 4.004 | Medium, SemiBold, Bold, ExtraBold, Black | The Poppins Project Authors (Indian Type Foundry) |
| Montserrat | 9.000 | Variable weight (`Montserrat[wght].ttf`) | The Montserrat Project Authors (Julieta Ulanovsky) |
| Anton | 2.116 | Regular | The Anton Project Authors (Vernon Adams) |

Fonts you add yourself are copied into the app's settings folder and never leave your computer.

The app's own interface uses three more fonts. They come from the same commit and are under the same license. In the installed app their licenses are in `licenses/fonts/ui`, and in the source repository they sit next to the fonts in `src/renderer/src/ui/fonts`.

| Font | Version | Files | Copyright |
|---|---|---|---|
| Onest | 2.001 | Variable weight (`Onest[wght].ttf`) | The Onest Project Authors |
| Unbounded | 1.701 | Variable weight (`Unbounded[wght].ttf`) | The Unbounded Project Authors |
| DM Mono | 1.000 | Regular, Medium | The DM Mono Project Authors |

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

## Lottie player

Lottie animations are drawn by dotLottie Web 0.81.0 (`@lottiefiles/dotlottie-web`, MIT, Copyright (c) 2023 LottieFiles.com, https://github.com/LottieFiles/dotlottie-web). Its JavaScript is compiled into the app's code, and its WebAssembly file (`dotlottie-player.wasm`) ships next to it. The WebAssembly is built from:

- dotlottie-rs (MIT), https://github.com/LottieFiles/dotlottie-rs
- ThorVG (MIT), https://github.com/thorvg/thorvg, including its WebP decoder, which is based on libwebp (BSD-3-Clause)
- Rust crates under MIT or Apache-2.0 (dual-licensed): miniz_oxide 0.8.9 (also Zlib), hashbrown 0.17.1, dlmalloc 0.2.13, once_cell 1.21.4, tinyrlibc 0.5.1, console_error_panic_hook 0.1.7

## Finding people

- MediaPipe Tasks Vision 1.1.1 (`@mediapipe/tasks-vision`, Apache-2.0, Copyright Google LLC, https://github.com/google-ai-edge/mediapipe). Its JavaScript is compiled into the app's code, and its WebAssembly (`vision_wasm_internal.wasm` with its loader) ships next to it.
- MediaPipe's Pose Landmarker (full) and Face Landmarker models (Apache-2.0, https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker), in `tools/pose-landmarker-full` and `tools/face-landmarker`.

## Telling voices apart

- sherpa-onnx 2.0.1 (Apache-2.0, the k2-fsa project), https://github.com/k2-fsa/sherpa-onnx. The prebuilt Node addon for Windows x64 from the npm package `sherpa-onnx-win-x64` ships in `tools/sherpa-onnx`, with the ONNX Runtime 1.28.2 DLLs it needs (MIT, Copyright (c) Microsoft Corporation, https://github.com/microsoft/onnxruntime).
- The 3D-Speaker CAM++ speaker embedding model (`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced`, Apache-2.0, the 3D-Speaker project, https://github.com/modelscope/3D-Speaker), as converted to ONNX by the sherpa-onnx project. It ships in `tools/voice-embeddings`.

## Downloaded on first use, not included

The first time you transcribe, Rezzo downloads these into `%LOCALAPPDATA%\Rezzo\tools`. They aren't part of the installer.

- whisper.cpp v1.9.5 (MIT). The CUDA build includes NVIDIA's CUDA runtime, which is covered by the NVIDIA CUDA EULA. The CPU build includes OpenBLAS (BSD-3-Clause).
- The Whisper large-v3-turbo model, converted to ggml format (MIT).

Exact URLs and checksums for everything above are in `tools.json` in the source repository.
