# Phase 0 report

Measured on the reference machine: Windows 11, GTX 1660 6 GB (driver 621.01), Ryzen 7 5700X, 32 GB RAM. Electron 45.1.0, FFmpeg 9.0.2, whisper.cpp v1.9.5 (CUDA 12.4).

| Spike | Status |
|---|---|
| 0a Transcription | done for Serbian and Croatian (3 of 4 clips corrected); Bosnian not scored |
| 0b Faces and lips | face positions solved (face detector + pose); lip-based speaker detection does not work well enough |
| 0c GPU export | done on a synthetic source; speed to be re-checked on real footage |

## Conclusions

Phase 0 asked whether the three riskiest parts work on ordinary hardware and on the kind of footage Rezzo is for. Two work as planned. The third works for framing but not for telling who is talking, and Phase 4 changes because of it.

### What we build on

| Area | Decision | Why (details below) |
|---|---|---|
| Transcription model | **whisper.cpp large-v3-turbo q5_0** with DTW word timings (flash attention off) | Most accurate of the six (tied with turbo f16), 1 h of audio in 6 min; large-v3 is slower, loops on noisy audio and turns Serbian ekavian into ijekavian |
| Language | **The user picks sr/hr/bs** per project; no auto-detect | Auto-detect is a coin toss between the three; the setting itself changes WER by a few points |
| Prompts | **None** | Every initial prompt tried (script hint, glossary) made results worse |
| Fixing recurring mistakes | **A user-editable replacement list** applied to words after transcription, keeping their timings | "futbal" for "fudbal" is systematic in every model and prompts don't fix it |
| Word timing | Turbo's DTW times, **with a correction to be tuned in Phase 2** | They run about 120 ms late on the words that needed fixing; alternative: re-align only the selected clip with large-v3 q5_0 |
| Transcript text | Always Latin via `transliterate.ts` | Only medium with `sr` wrote Cyrillic, but the step is cheap and tested |
| Export | **WebGL → YUV 4:2:0 in a shader → async readback → FFmpeg `h264_nvenc`, `libx264` as fallback** | Frame-exact, matches the preview (≥ 45.7 dB), 230–245 fps; WebCodecs' software encoder drops frames and its hardware one writes no colour tags |
| Working file | **H.264, no B-frames, keyframe every 15 frames, constant frame rate, BT.709 tags, first video stream only** | Seeks in ≤ 20 ms, frame-accurate; the clips showed variable frame rate, missing colour tags and a cover-image stream, all of which the conversion has to normalise |
| Decoding | WebCodecs; **close every frame you don't keep, immediately** | Holding ~14 decoded frames crashed the GPU process |
| Finding people | **MediaPipe Pose** for heads (works in profile and in wide shots), **Face Landmarker** on head crops for faces and lips | BlazeFace alone found nobody in the wide shot |
| Camera cuts | Mean difference of 32×18 thumbnails | Found ~10 cuts and dissolves where FFmpeg's scene filter found 3 |
| Analysis cost | Run face/pose analysis **on the selected clip only** | ~150 ms per analysed frame: fine for a minute, too slow for a whole episode |

### What changes

- **Phase 4, who is talking:** lips don't decide it on this footage (3 points better than guessing in single shots, nothing in the one usable two-shot). The plan becomes: camera cuts first (the director already chose: right 78% of the time), then speaker turns from audio, then lips as a tie-breaker on close shots. **Manual correction by clicking** is a main tool, not a fallback, at least for single-camera wide shots. Telling voices apart from audio (diarization, without Python) needs its own short spike at the start of Phase 4.
- **Phase 2, captions:** transcript editing has to be fast. Expect to fix one word in seven on good studio audio and one in three on dialect or bad audio. The replacement list belongs here too.

### Still open

- **Bosnian (`bs`)**: the Bosnian clip wasn't corrected, so the setting isn't scored. Given how little the setting mattered for Serbian and Croatian, we don't expect a surprise.
- **Bundle size**: the CUDA build of whisper.cpp is 685 MB zipped (285 MB for the CUDA 11.8 build, not yet tested), and its CUDA runtime DLLs fall under NVIDIA's EULA. Settled in Phase 1: the app downloads whisper.cpp and the model the first time you transcribe, so we don't redistribute those DLLs.
- **Head tracking in wide shots** jumps (101 track ids in 67 s) and needs smoothing in Phase 4.

Export speed on real footage and the cost of moving FFmpeg out of the renderer were measured at the start of Phase 1; see [Phase 1 checks](#phase-1-checks).

## Test clips

Four clips supplied by the maintainer, kept outside the repo. Together they cover the footage types we planned for:

| Clip | Source | Covers |
|---|---|---|
| A | 1920×1080, 30 fps, 53 s | one speaker, medium shot, fast hand movement; last 3.5 s is a screen recording |
| B | 480×360 (4:3), 23.976 fps, 70 s | one speaker, very low resolution, lower-third graphics, embedded cover image stream |
| C | 1280×720, variable frame rate, 67 s | wide shot, two people far from the camera, one mostly in profile |
| D | 640×480 (4:3), 30 fps, 76 s | multi-camera: close-ups of each speaker, a wide two-shot, cuts and dissolves |

What the working-file conversion has to handle, seen on these four alone: two clips have no colour tags, one has a variable frame rate, one carries a cover image as a second video stream, and two are 4:3 at SD resolution.

## 0a — Transcription (without ground truth so far)

96 runs: 4 clips × 6 models (large-v3-turbo, large-v3, medium; each in f16 and q5_0) × language `sr`, `hr`, `bs`, `auto`. All with DTW word timings (`-dtw`, which only works with flash attention off: with it on, every `t_dtw` is −1).

### Speed

All four clips joined (266 s of audio), language `sr`, GTX 1660:

| Model | Flash attention, no DTW | With DTW word timings |
|---|---|---|
| large-v3-turbo | 5.8× realtime (1 h in 10.4 min) | 5.0× (11.9 min) |
| **large-v3-turbo q5_0** | **13×** (4.6 min) | **10×** (6.0 min) |
| large-v3 | 2.2× (27 min) | 1.9× (31 min) |
| large-v3 q5_0 | 5.2× (11.5 min) | 3.8× (15.9 min) |
| medium | 5.8× (10.4 min) | 3.5× (17 min) |
| medium q5_0 | 7.9× (7.6 min) | 4.9× (12.1 min) |

The quantized models are about twice as fast as f16 on this card (whisper.cpp warns that the GTX 1660 has no tensor cores). Only turbo, and its q5_0 version most comfortably, meets "1 hour in ≤ 12 min" with word timings on.

### What the outputs show before scoring (`whisper/precheck.ts`)

1. **Script:** large models always write Latin. Only `medium` with `sr` writes Cyrillic (100% on one clip, 47% for q5_0). The transliteration handles both.
2. **Diacritics:** no model drops them wholesale. 9–18% of words contain č/ć/š/ž/đ for every model, with similar shares. Whether they're on the right words needs the corrected text.
3. **Hallucination:** large-v3 (f16 and q5_0) adds 22–26% extra words on the noisy wide-shot clip by repeating the same segment up to four times. Turbo and medium don't. No other clip loops.
4. **Language auto-detection is a coin toss between sr, hr and bs:** the Serbian clip D is detected as `bs` by every model, the Bosnian clip A as `hr` or `sr`. The app should let the user pick the language (per project) rather than auto-detect.
5. **Dialect drift can't be measured this way on one-minute clips.** Counting only words that actually differ between ekavian and ijekavian (vreme/vrijeme, gde/gdje, ...; `whisper/dialect.ts`) leaves 1–5 such words per clip. One pattern still stands out: on Serbian clip D, turbo keeps every one of them ekavian under all language settings, while large-v3 turns 33–67% of them ijekavian. That matches the "pobedi" → "pobjedi" substitutions in the scored transcripts below. (An earlier version of this point used a pattern that also counted words like "jedan" and "nije", and its conclusion didn't hold.)

6. **A Latin initial prompt** (one sentence with č, ć, š, ž, đ and no ekavian/ijekavian words; 36 runs on turbo, turbo q5_0 and large-v3 q5_0) changes little before scoring. The script was already Latin, and the diacritic share moves by at most 2 points. It makes large-v3 q5_0 loop more on clip C (4 repeated segments instead of 1), and turbo q5_0 with `hr` drops about 10% of the words on clip D. So far it looks risky rather than helpful; scoring will tell.

### Accuracy (2 of 4 clips corrected so far)

The maintainer has corrected clip B and clip D. Both are Serbian, 389 words in total, with 37 timing labels (13 of them moved). Language `sr`, scored with `whisper/metrics.ts --clips ...`:

| Model | WER | Diacritic errors | Word start, DTW, on moved labels (signed median) | DTW start within 200 ms (all labels) | Speed with DTW |
|---|---|---|---|---|---|
| **large-v3-turbo** | **16.5%** | 0% | +120 ms (late) | 94% | 11.9 min/h |
| **large-v3-turbo q5_0** | **17.0%** | 0% | +120 ms | 94% | **6.0 min/h** |
| large-v3 | 20.1% | 0.3% | +43 ms | 100% | 31 min/h |
| large-v3 q5_0 | 21.9% | 0.3% | +43 ms | 100% | 15.9 min/h |
| medium | 37.0% | 0% | +237 ms | 83% | 17 min/h |

- **Turbo is the most accurate as well as the fastest** (it also made the drafts, so read its lead with some caution). WER is a little above the 15% target. About a tenth of turbo's errors are one word, below; the rest are case endings, words run together ("dobroveče"), and names.
- **Diacritics are essentially solved:** no turbo error is diacritics-only.
- **`large-v3` turns Serbian ekavian into ijekavian** ("pobedi" → "pobjedi") even with `sr` set.
- **Whisper's own word timestamps are about 200 ms early. DTW timestamps from turbo are about 120 ms late** on the words the maintainer had to move, which matches what he noticed. large-v3's DTW is much tighter (+43 ms), but that model is slower and loops on noisy audio. Options for Phase 2 (captions): a small fixed shift for turbo, or re-aligning just the selected clip with large-v3 q5_0 (about 16 s for a minute of audio).
- **"futbal" instead of "fudbal" is systematic:** every model and setting writes "futbal", in 5 of the reference's 10 occurrences. A glossary prompt ("fudbal, fudbala, fudbaler, fudbalski") does not fix it and pushes WER from 17% to 22–25%. Initial prompts hurt in every form tried, so the fix belongs after transcription: a user-editable replacement list applied to the words, keeping their timings.

#### Update: three clips corrected (clip C added)

The maintainer then corrected clip C (Croatian, strong regional dialect) and marked who speaks on each line of clip D ("A:", "M:"). Those tags are stripped before scoring. An earlier version of this table counted them as 31 extra words and blamed the resulting "deletions" on cross-talk; that was wrong. Clip C's timing labels weren't reviewed, so `metrics.ts` now ignores label files still in the generator's 3-decimal format; timing figures stay on clip B and clip D.

| Model and language | All three clips | clip B (sr) | clip D (sr) | clip C (hr) |
|---|---|---|---|---|
| large-v3-turbo, `hr` | **23.9%** | 20.8% | 16.7% | **35.4%** |
| large-v3-turbo q5_0, `sr` | 24.6% | 20.1% | 15.4% | 39.7% |
| large-v3-turbo, `sr` | 24.9% | 20.1% | **14.6%** | 41.8% |
| large-v3-turbo q5_0, `hr` | 26.6% | 23.5% | 16.7% | 41.8% |
| large-v3, `sr` | 26.1% | 20.1% | 20.0% | 38.6% |
| large-v3, `hr` | 35.5% | 20.8% | 20.8% | 65.6% (loops) |

- **Dialect beats everything else.** The speaker in clip C uses a strong regional dialect (ikavian forms), which the maintainer transcribed as spoken. Whisper normalises or mishears it, so every model is at 35–42% WER there, worse than on the noisy-but-standard clips.
- **The language setting matters, but only a little and not consistently.** On the Croatian clip, `hr` helps turbo f16 (35.4% vs 41.8% with `sr`) but not turbo q5_0 (41.8% vs 39.7%). On the Serbian clips `sr` and `hr` are within about 3 points. Nothing argues against simply using the language the user picks.
- **Against the 15% target:** met on the studio clip with standard speech (clip D, 14.6–16.7% with turbo) and missed on the very low-quality 360p broadcast (clip B, 20%) and the dialect wide shot (clip C, 35–42%). For captions that means fixing between one word in seven and one in three. Phase 2's transcript editing has to be fast.

Still missing: a Bosnian clip (clip A), so there is nothing yet on `bs`.

Drafts for hand correction come from large-v3-turbo. That may slightly favour turbo in the scores, since mistakes it shares with the draft are easier to miss.

## 0b — Faces and lips (first pass)

`faces/lab` runs MediaPipe in Electron (GPU delegate) at 10 frames per second. Candidates come from three detectors: BlazeFace on the whole frame, BlazeFace on 2-row tiles, and BlazeFace on 4-row tiles. They are merged, and each one is checked by running the Face Landmarker on a 2× crop upscaled to 256 px. A candidate counts as a face only if the landmarker confirms it. Mouth opening is the inner-lip gap divided by face height. A simple IoU tracker follows faces and resets on cuts.

| Clip | Frames with a face: full frame / plain Face Landmarker / with tiles | Faces per frame | Face height (median) | Tiles needed for | Time per frame (full / 2-row / 4-row / crops) |
|---|---|---|---|---|---|
| A | 94% / 85% / 98% | 1 in 93% | 257 px | 7% of faces | 9 / 21 / 71 / 16 ms |
| B | 100% / 100% / 100% | 1 in 91% | 76 px | 9% | 5 / 14 / 61 / 17 ms |
| D | 88% / 88% / 97% | 1 in 87%, 2 in 9% | 114 px | 18% (the wide two-shot) | 5 / 13 / 58 / 27 ms |
| C | **0% / 0% / 34%** | mostly wrong | 47 px | 100% | 6 / 20 / 73 / 46 ms |

Findings so far:

1. **Close and medium shots work**, even at 480×360. Tiling recovers the two small faces in the clip D wide shot (about 50 px tall in 480p).
2. **Wide shots fail.** In clip C neither the full frame nor the plain Face Landmarker ever finds a face. With tiles we find the frontal face only some of the time. We never find the man in profile with a cap. Landmark confirmation still lets through some false positives (a wall, a hand holding a bottle). BlazeFace short-range is a selfie model, and tiling doesn't fix that.
3. **Cut detection on 32×18 thumbnails works.** It finds about 10 cuts and dissolves in clip D, each dissolve showing up as two consecutive steps. FFmpeg's `scene` filter found only 3. Normal motion stays below a difference of about 10; cuts are above 30.
4. **Speed is fine for a clip, not for an episode.** About 150 ms per analysed frame with all methods on. That is 90 s for a 1-minute clip at 10 fps, so tracking should run on the selected clip only, not the whole episode.

### Second pass: heads from body pose

The Pose Landmarker (full model, up to 4 people) runs on the whole frame. Each head box comes from the nose, eye, ear and mouth points, sized by ear distance, or by shoulder width when the person is in profile. The Face Landmarker then runs on a crop around each head.

| Clip | Frames with a person (pose lite / full) | Heads per frame (full) | Head height (median) | Mouth measured on heads | Pose time per frame (lite / full) |
|---|---|---|---|---|---|
| A | 98% / 98% | 1 in 97% | 286 px | 99% | 17 / 18 ms |
| B | 99% / 100% | 1 in 100%, one track for the whole clip | 103 px | 100% | 13 / 14 ms |
| D | 100% / 100% | 1 in 87%, 2 in 13% | 145 px | 80% | 17 / 15 ms |
| C | **95% / 91%** | 1 in 58%, **2 in 31%** | 54 px | **13%** | 18 / 19 ms |

5. **Pose finds the people the face detector can't.** In clip C it puts correct head boxes on both men, including the one in profile with a cap that BlazeFace never found. On close and medium shots it's also cleaner than the face detector: no second "face" in clip B, where BlazeFace had a false one in 8% of frames.
6. **Mouth movement is only measurable on close and medium shots.** On 54 px heads, often in profile, the Face Landmarker gives up (13%). In wide shots, deciding who is talking will have to rely on audio and body movement, not lips.
7. **Head tracks are unstable in the wide shot** (101 track ids in 67 s): the pose model drops a person for a frame or two. Phase 4 needs smoothing and identity across short gaps, not plain IoU matching.

### Active speaker (`faces/speakers.ts`)

**Clip C:** the maintainer reports that only the man on the right talks. Speech times come from the transcript's word timings (29 segments, 43.7 s). Over 534 frames of speech:

| Guess | Gives an answer | Right when it answers |
|---|---|---|
| mouth movement | 17% | 93% |
| largest head | 90% | 92% |
| the only person in frame | 60% | 94% |

When the mouth can be measured, it points at the right person, but on this wide shot it can be measured only 17% of the time. The other two numbers mostly show that the pose model misses the reclining man on the left more often than the one talking. With one speaker, "always him" would score 100%, so this clip says little about choosing between two people.

**Clip D:** the maintainer tagged each transcript line with its speaker (A/M) instead of timed labels. `speakers.ts` aligns that transcript with the draft's words to give each line a start and end. Who is who on screen: shirt colour in close-ups (one light shirt, one dark jacket, sampled just under the chin), seat position in the two-shot. Checked by eye against the debug video at 19 points.

| Guess | Gives an answer | Right when it answers |
|---|---|---|
| mouth movement | 91% | 78% |
| largest head | 100% | 76% |
| the only person in frame (the director's cut) | 90% | 78% |
| mouth movement, both men in frame | 2% (13 frames) | 46% |

In single-person shots, can the mouth tell whether the person shown is talking (79% of the time) or listening (a reaction shot)?

| Signal | Mean when talking / listening | Best threshold | Always "talking" |
|---|---|---|---|
| mouth movement (std of opening, ±0.4 s) | 0.0179 / 0.0143 | 82% | 79% |
| mouth follows the sound (correlation with loudness, ±1 s) | 0.02 / 0.03 | 79% | 79% |

8. **Lip-based speaker detection doesn't work on this footage.** In single-person shots, mouth movement adds 3 points over guessing "talking". Correlating the mouth with the sound adds nothing. Listeners laugh, nod and mouth along, and at 10 fps on 480p crops the lip signal is noisy. The one real two-person case (the wide shot) is too short to measure.
9. **The director's cut is the strongest signal we have for multi-camera shows:** the person shown is the one talking 78% of the time.

### Proposed approach for Phase 4

- **Where people are:** pose (works in profile and in wide shots), face landmarks when the face is big enough.
- **Who is talking:** not lips alone. Use the camera cut (in multi-camera shows the director already chose) and speaker turns from the audio. Telling voices apart (speaker diarization) can be checked in a short follow-up spike, still without Python. Lips stay as a tie-breaker on close shots.
- **Manual correction by clicking** (already in the roadmap) carries more weight than planned: on single-camera wide shots it may be the main tool for a while.
- **The cut detector** resets tracking and marks shots.

## 0c — GPU export from Electron

### Setup

`export/make-source.ts` generates a 60 s, 1920×1080, 30 fps BT.709 source. Every frame carries its own number as 16 black/white blocks, plus colour bars, a moving ramp, and once a second a one-frame white square with a 50 ms beep. From it we make working files with keyframes every 1, 15, 30 and 60 frames (x264, no B-frames) and one with NVENC.

The lab (`export/lab/`) decodes the working file with WebCodecs, renders the "full frame over blurred background" layout in WebGL2 at 1080×1920, stamps its own output frame number at the bottom, and exports 50 s (frames 150–1649) five ways:

- **A-rgba-nvenc**: read RGBA back from WebGL, FFmpeg converts to YUV and encodes with NVENC
- **A-yuv-nvenc**: convert to YUV 4:2:0 in a shader, read that back (2.7× less data), FFmpeg encodes with NVENC
- **A-yuv-x264**: same, encoded with libx264 (software fallback)
- **B-webcodecs-hw**: Chromium's WebCodecs encoder on the GPU; FFmpeg only muxes
- **B-webcodecs-sw**: same with the software encoder

Readback in A uses three pixel buffer objects so the GPU, the readback and FFmpeg overlap. `export/verify.ts` decodes each result and reads the frame numbers, compares sample frames with the renderer's own pixels, and matches flashes to beeps.

### Results

Export of a 50 s clip (1500 frames), second run (after the code review fixes); speeds vary noticeably between runs, the first run is in brackets:

| Path | Time | Speed | Frames correct | Drops / dups | Min PSNR vs preview | Colour shift on bars (R, G, B) | Colour tags |
|---|---|---|---|---|---|---|---|
| A-rgba-nvenc | 11.5 s | 131 fps (128) | 1500/1500 | 0 / 0 | 45.7 dB | 0.04, 0.02, 0.05 | matrix and range only |
| **A-yuv-nvenc** | **6.2 s** | **243 fps** (232) | 1500/1500 | 0 / 0 | 45.9 dB | 0.04, 0.01, 0.06 | complete |
| **A-yuv-x264** | **6.5 s** | **231 fps** (182) | 1500/1500 | 0 / 0 | 46.2 dB | 0.02, 0.00, 0.04 | complete |
| B-webcodecs-hw | 8.5 s | 178 fps (280) | 1500/1500 | 0 / 0 | 45.7 dB | 0.04, 0.01, 0.04 | none |
| B-webcodecs-sw | 10.1 s | — | 1/1500 | encoder dropped 93% of frames | 20.5 dB | — | — |

A/V sync (all working paths): 49 of 50 beeps start 0.04 ms after their flash. The first one, sitting exactly on the cut point, starts 13 ms late because of AAC encoder priming at the cut. That is less than half a frame and not a drift.

Seeking in the working file (25 random frames, decode + render + readback):

| Working file | Median | p95 | Max | Frame-accurate | Sequential decode |
|---|---|---|---|---|---|
| keyframe every frame | 4 ms | 5 ms | 16 ms | 25/25 | 811 fps |
| every 15 | 13 ms | 20 ms | 20 ms | 25/25 | 920 fps |
| every 30 | 26 ms | 36 ms | 37 ms | 25/25 | 924 fps |
| every 60 | 29 ms | 69 ms | 69 ms | 25/25 | 932 fps |
| every 30, NVENC | 22 ms | 35 ms | 36 ms | 25/25 | 936 fps |

Preview: decode + render + display runs at 192 fps uncapped; at 30 fps paced playback 0 of 300 frames missed their slot (worst 12.6 ms late, within one frame).

### Against the success criteria

| Criterion | Target | Result |
|---|---|---|
| Dropped or duplicated frames | none | none (A paths, B-hw) |
| Export vs preview | PSNR ≥ 40 dB, no colour shift | 45.7–46.2 dB, shift ≤ 0.06 levels |
| A/V sync | ≤ 1 frame | 0.04 ms (13 ms on the first beep at the cut) |
| Export speed | 60 s clip in ≤ 60 s | 50 s clip in 6.2 s (NVENC), 6.5 s (x264) |
| Seek in working file | ≤ 100 ms | ≤ 69 ms worst case, all frame-accurate |

### Findings

1. **Close decoded frames immediately.** The hardware decoder has a small pool of output pictures. Holding 14 undisplayed frames while seeking crashed the renderer. The decoder now closes unwanted frames as they arrive.
2. **WebCodecs' software H.264 encoder is not usable as a fallback.** It silently dropped 93% of the frames.
3. **WebCodecs' hardware encoder writes no colour information** into the stream. Players would have to guess BT.709. Fixable at mux time, but it's one more thing we don't control.
4. **Reading back RGBA is the bottleneck of path A.** 75% of the time is spent waiting for the readback. Converting to YUV on the GPU first cuts the data from 8.3 to 3.1 MB per frame and nearly doubles the speed.

### Decision (proposed)

- **Export pipeline:** path A-yuv. WebGL renders the frame, a shader converts it to BT.709 YUV 4:2:0, the result is read back asynchronously and piped to FFmpeg, which encodes with `h264_nvenc` and falls back to `libx264` with the same pipeline. B-hw was 20% faster in the first run and 27% slower in the second, so it has no reliable speed edge, while A gives us full control of colour, bitrate and tags, a working software fallback, and the same code path for macOS/Linux encoders later.
- **Working file:** H.264, no B-frames, keyframe every 15 frames (seek ≤ 20 ms). To be re-checked on real footage, where decoding is heavier and files grow faster with short keyframe intervals.

### Still open

All three points left open here (speed on real footage, timing the working-file conversion on real clips, the cost of a sandboxed renderer with FFmpeg in a utility process) are answered in [Phase 1 checks](#phase-1-checks).

## Phase 1 checks

Two questions Phase 0 left open, measured before the app is built around them. Same machine; `ipc/` in the spikes.

### FFmpeg in a utility process

The app keeps the renderer sandboxed, so FFmpeg runs in an Electron utility process and every exported frame (3.1 MB of YUV) has to cross over. `ipc/` does the Phase 0 A-yuv export with that layout.

- An ArrayBuffer can't be transferred to the utility process: listed as transferable, the message arrives as `null`. Every frame is copied, about 4.4 ms each (230 fps, 0.7 GB/s) with nothing else running.
- That copy happens inside `postMessage`, on the thread that calls it. Posting from the rendering thread blocks rendering for the whole copy.
- Handing the frame to a dedicated Web Worker first (an in-process transfer, no copy) and posting from there takes the copy off the rendering thread.

Export of the same 50 s synthetic clip (1500 frames) and of real clip A (1584 frames, 1920×1080, 30 fps), NVENC unless noted:

| Path | Synthetic | Real clip A | Real clip A, x264 |
|---|---|---|---|
| FFmpeg in the renderer (Phase 0 layout, same session) | 240 fps | — | — |
| Utility process, posted from the rendering thread | 138–179 fps | 139–179 fps | 109–113 fps |
| **Utility process, posted from a Web Worker** | **180–185 fps** | **192–228 fps** | 93–114 fps |

The Web Worker path passes `export/verify.ts` like the Phase 0 runs did: 1500/1500 frames, no drops or duplicates, 45.9 dB against the preview, A/V within 0.3 ms on average. A 60 s clip exports in about 8 s with NVENC and 14–17 s with x264.

Decision: FFmpeg lives in a utility process; the renderer passes frames through a dedicated Web Worker that owns the MessagePort. The export goal (60 s in ≤ 60 s) holds with plenty of room.

### Converting real clips to working files

The working-file conversion as the app will run it (first video stream, H.264 without B-frames, keyframe every 15 frames, constant frame rate, BT.709 tags, AAC audio):

| Clip | Source | x264 veryfast | NVENC p4 | Size (x264 / NVENC) |
|---|---|---|---|---|
| A | 1080p30 | 5.3 s (10× realtime) | 3.6 s (15×) | 48 / 73 MB per minute |
| B | 360p23.976, cover image | 1.1 s (61×) | 1.2 s (61×) | 8 / 11 MB per minute |
| C | 720p, variable frame rate | 2.5 s (26×) | 2.5 s (27×) | 28 / 42 MB per minute |
| D | 480p30 | 2.0 s (38×) | 2.0 s (38×) | 10 / 16 MB per minute |

A one-minute 1080p clip is ready in about five seconds. Below 1080p, NVENC isn't faster than x264 and makes bigger files. The working file uses x264.

### Which whisper.cpp build to download

The app downloads whisper.cpp the first time you transcribe. Clip D (76 s), turbo q5_0, DTW on, same settings as above:

| Build | Download | Time | Notes |
|---|---|---|---|
| CUDA 12.4 | 685 MB | 13 s | uses the GTX 1660 |
| CUDA 11.8 | 285 MB | 45 s | reports "no GPU found" on this machine and runs on the CPU |
| CPU with OpenBLAS | 22 MB | 34 s | 2.2× realtime with 8 threads |

The CUDA 11.8 build would have saved 400 MB, but it doesn't see the card here, so the app uses CUDA 12.4 with an NVIDIA card and the OpenBLAS CPU build otherwise (and when the CUDA build fails to start). On the CPU an hour of audio takes about 27 minutes. GPU and CPU runs don't produce identical text, but each is deterministic from run to run.

### Working files and preview in the app (1b)

Things that came up while wiring the working file and the preview into the app. All checked on synthetic sources whose frames show their own number.

- **Cuts are frame-exact.** Working files at 25, 30 and 29.97 fps that start at source frames 0, 61 and 250 all begin on exactly that frame, with `-ss` before the input. `e2e/clip.e2e.ts` checks the same thing through the whole app: after making a clip, the renderer draws the clip's first frame and steps from there.
- **Colour tags need setting on the frames.** Once a `scale` filter is in the chain (the app uses it to convert BT.601 sources and to cap 4K+), libx264 writes the matrix and range but leaves primaries and transfer as "unknown", because it takes them from the frames rather than from `-color_primaries`/`-color_trc`. A `setparams` filter at the end of the chain fixes it.
- **One file for picture and sound.** Web Audio's `decodeAudioData` reads the AAC track straight from the working file in Electron 45, so the preview needs no separate audio file. The audio clock drives playback; late frames are skipped, the sound never is.
- **Cover images.** `-map 0:V:0` (capital V) skips attached pictures, so a file with a cover image first gets its real video stream.

### Export and installer in the app (1c)

The Phase 0 export path, as the app now runs it: the page renders each frame with the preview's compositor, converts it to YUV on the GPU, and hands it to a Web Worker that posts it to FFmpeg in the media worker. Checked on synthetic sources whose frames show their own number (`e2e/export.e2e.ts`), with NVENC and with x264:

- **Frame-exact.** Every frame of the clip is in the file once and in order, and a layout change lands on its keyframe's frame.
- **Matches the preview.** The exported frame against the preview's own pixels: over 40 dB on every row compared.
- **BT.709 tags on the file, the sound from the working file.** The audio length is within a frame of the video.
- **A cancelled export leaves nothing behind**, but only because the worker waits for FFmpeg to exit before deleting the part file. Windows refuses to delete a file a running process still has open.
- **The installer** is 178 MB. Installed, Rezzo takes 543 MB, of which FFmpeg is 184 MB and the app's own code 2 MB; the rest is Electron. The end-to-end tests pass against the packaged app too, which shows the worker loads from the asar archive and FFmpeg is found in `resources/tools`.

Export speed on the four real clips in the app is still to be measured.

## Phase 2 checks

### Correcting DTW word starts (2a)

Phase 0 found turbo's DTW starts about 120 ms late on the words the maintainer moved. Before picking a correction, `whisper/metrics.ts --shift-sweep large-v3-turbo-q5_0` shifts every DTW start by a constant and scores it against the reviewed labels of clips B and D (34 labels matched, 12 of them moved by hand), with the model and language the app uses:

| Shift | All labels within 100 ms | All within 200 ms | Moved labels: signed median | Moved within 100 ms |
|---|---|---|---|---|
| 0 ms | 79% | 94% | +120 ms | 42% |
| −60 to −80 ms | 91% | 100% | +40 to +60 ms | 75% |
| **−100 ms** | **88%** | **100%** | **+20 ms** | **83%** |
| −140 ms | 32% | 100% | −20 ms | 92% |

Both samples lean one way. The labels the maintainer left alone sit exactly on the draft's DTW times, which favours no shift; the moved ones were picked because they were wrong, which favours a large one. The app uses **−100 ms**: every label lands within 200 ms, most of both groups within 100 ms, and what error is left makes a highlight a little early rather than late, which is easier to watch. Word ends are not shifted; the labels only mark starts.

## Phase 3 checks

### Video layers with alpha (3b)

Before building video layers I wanted to know three things: which files with transparency our FFmpeg can actually read, whether the "stacked" trick holds up (colour in the top half of an ordinary H.264 working file, alpha as brightness in the bottom half, so a layer with transparency goes through the same WebCodecs decoder as everything else), and how many such layers the GTX 1660 can decode alongside the main video. Everything here is synthetic except the main video in the decoding lab, which is real clip A's working file. Scripts are in `layers/`.

The test pattern is 1920×1080, 30 fps, 4 s, made with FFmpeg's `geq`: a moving circle with a soft 24 px edge, a hard-edged rectangle, 2 px vertical lines and an alpha ramp along the bottom. The colour keeps changing under transparent areas, so anything that smears chroma across an edge shows.

#### Which formats keep their alpha

Each format is encoded from the lossless pattern, decoded back with FFmpeg and compared with the original. "Colour × alpha" ignores colour under fully transparent pixels.

| Format | MB/s | Stream `pix_fmt` | First frame `pix_fmt` | Alpha kept | Alpha PSNR | Colour × alpha |
|---|---|---|---|---|---|---|
| WebM VP9, default decoder | 0.17 | yuv420p (`alpha_mode=1`) | yuv420p | **no** | | |
| WebM VP9, `-c:v libvpx-vp9` | | | yuva420p | yes | 57.4 dB | 52.0 dB |
| WebM VP8, default decoder | 0.89 | yuv420p (`alpha_mode=1`) | yuv420p | **no** | | |
| WebM VP8, `-c:v libvpx` | | | yuva420p | yes | 57.4 dB | 51.0 dB |
| ProRes 4444 | 34.8 | yuva444p12le | yuva444p12le | yes | 57.0 dB | 61.4 dB |
| HEVC with alpha (x265) | 0.14 | **yuv420p** | yuva420p | yes | 55.6 dB | 51.8 dB |
| QuickTime Animation (qtrle) | 230 | argb | argb | yes | lossless | lossless |
| PNG in MOV | 8.4 | rgba | rgba | yes | lossless | lossless |
| APNG | 8.4 | rgba | rgba | yes | lossless | lossless |
| Animated WebP | 0.81 | argb | yuva420p | yes | 58.0 dB | 49.1 dB |
| GIF | 5.0 | bgra | bgra | yes, 1 bit | 17.6 dB | 21.5 dB |
| H.264 (no alpha, control) | 0.33 | yuv420p | yuv420p | no | | |

Two traps. FFmpeg's own VP8/VP9 decoders silently drop the alpha; only libvpx keeps it, so WebM needs `-c:v libvpx-vp9` (or `libvpx`) in front of the input. And HEVC with alpha reports plain `yuv420p` on the stream; only a decoded frame shows `yuva420p`. So the probe can't trust the stream's pixel format. What works for every file above: if the stream has `alpha_mode=1`, it has alpha (and needs libvpx); otherwise ask ffprobe for the first frame's `pix_fmt` (`-read_intervals %+#1 -show_entries frame=pix_fmt`) and look for an alpha channel. GIF transparency is on or off per pixel, which is what GIF is; it works, with hard edges.

#### The stacked working file

The pattern converted to stacked H.264 the way the app makes working files (x264 veryfast, CRF 16, keyframe every 15, no B-frames, BT.709), decoded with FFmpeg and judged as a composite over a grey checkerboard:

| Variant | Size | MB/min | Alpha PSNR | Colour × alpha | Composite | Composite, soft edges only | Alpha leaking across the seam (max) |
|---|---|---|---|---|---|---|---|
| straight, halves of 1080 rows | 1920×2160 | 30.7 | 56.9 dB | 50.6 dB | 51.4 dB | 47.3 dB | 4 |
| **straight, halves padded to 1088** | 1920×2176 | 30.7 | 56.7 dB | 50.6 dB | 51.3 dB | 47.3 dB | 1 |
| straight, padded, NVENC | 1920×2176 | 74.0 | 57.8 dB | 50.7 dB | 51.4 dB | 47.5 dB | 0 |
| premultiplied, padded | 1920×2176 | 18.4 | 56.7 dB | 42.3 dB | 42.5 dB | 40.5 dB | 1 |
| straight, black under transparent pixels | 1920×2176 | 24.8 | 56.7 dB | 43.7 dB | 43.9 dB | 41.0 dB | 1 |

Alpha survives at about 57 dB in every variant, so the layout itself is sound. Colour depends on what sits under the transparent pixels. With 4:2:0 each chroma sample covers 2×2 pixels, so at a hard alpha edge the visible pixel shares its colour with the invisible one next to it. If the file's colour carries on smoothly under the transparency, that costs nothing; if it's black there, edge pixels get darker and less saturated. I expected premultiplying (colour × alpha, black where transparent) to help and it does the opposite: it makes every file behave like the worst case. So the colour half stays **straight**, exactly as the file has it. Real files with black or garbage under the alpha will land around 44 dB on the composite, which is still clean to the eye.

The seam needs padding. With 1080-row halves the boundary falls inside a 16-row macroblock and up to 4/255 of alpha leaks into the first rows of the alpha half: a faint line along the top edge of the layer. Padding each half to a multiple of 16 stops it. The decoding lab found a second reason (below): there must also be at least two black rows between the colour and the alpha, or the GPU blends chroma across the seam. Rule: each half is `ceil((height + 2) / 16) × 16` rows.

NVENC makes files 2.4 times bigger for no visible gain and, as the next table shows, isn't much faster here.

#### How long the conversion takes

Time to turn a 4 s 1080p overlay into a stacked working file, as a multiple of real time:

| Input | Decode only | RGBA filter graph | RGBA + x264 | YUV filter graph | YUV + x264 | YUV + NVENC |
|---|---|---|---|---|---|---|
| WebM VP9 (libvpx) | 16–20× | 5.5× | 3.0× | 7–14× | 3.5–4.3× | 5.0× |
| ProRes 4444 | 11.8× | 4.3× | 2.5× | 4.6× | 2.2–3.4× | 2.6× |
| HEVC with alpha | 3.5× | 2.6× | 2.6× | 3.2× | 2.9× | 2.5× |

The filter graph, not the encoder, is the slow part when it goes through RGBA; keeping it in YUV (copy the alpha plane out with `extractplanes=a`, expand it to limited range, stack) makes that step faster, after which x264 is the limit; how much faster depends on whether the input needs a colour-matrix conversion on the way (VP9 files often don't say which matrix they use). Either way a full-size 1080p overlay converts at 2.5–4× real time: a 30 s clip is ready in 8–12 s, smaller overlays much faster. That's fine with the progress shown on the layer's bar, as planned. I'll use the YUV graph and x264, like the main working file.

#### Decoding in the app (WebCodecs + WebGL)

`layers/lab/` uses the app's own `demux` and `FrameSource`, decodes the main working file (real clip A, 1080p30) and N stacked overlays in lockstep, uploads every frame to a texture and closes it right away, and composites at 1080×1920. Overlay sizes: 1920 wide (1920×2176 stacked), 1280 wide (1280×1472) and a full-screen vertical one (1080×3872).

First, does the alpha come out of WebCodecs the same as out of FFmpeg? Reading the bottom half's green channel, mostly yes, with one catch: when the content height is a multiple of 16 (720) and there is no padding, the first alpha row came out up to 38/255 too high across the whole width. The GPU interpolates chroma between neighbouring chroma rows, so the first alpha row gets colour from the last colour row, and once that colour is clamped to RGB no formula can undo it. With at least two black rows between the halves and alpha read as BT.709 luma of the bottom half (which cancels whatever chroma the encoder left there), WebCodecs and FFmpeg agree to within 1/255 on every pixel of the three frames compared, at both sizes.

Speed from the second of three runs (the other two, one of them with hardware decoding forced, are within a few percent unless noted); "uncapped" is decode and composite as fast as possible, the ceiling for export. Paced is 300 frames at 30 fps; a frame counts as late when it's more than one frame behind.

| Overlays | Uncapped | Late frames at 30 fps (worst lateness) | Paused seek, median / p95 |
|---|---|---|---|
| none | 249 fps | 0 (0 ms) | 28 / 53 ms |
| 1 × 1920 wide | 274 fps | 0 (1 ms) | 49 / 99 ms |
| 2 × 1920 wide | 183 fps | 0 (2 ms) | 76 / 145 ms |
| **4 × 1920 wide** | **103 fps** | **0 (3 ms)** | **118 / 193 ms** |
| 6 × 1920 wide | 72 fps | 0 (20 ms) | 180 / 236 ms |
| 8 × 1920 wide | 55 fps | 1 (42 ms); 37 in the hardware-only run | 215 / 299 ms |
| 4 × 1280 wide | 197 fps | 0 (0 ms) | 75 / 134 ms |
| 8 × 1280 wide | 113 fps | 0 (17 ms) | 127 / 202 ms |
| 4 × full-screen vertical | 104 fps | 0 (0 ms) | 104 / 172 ms |

With `hardwareAcceleration: 'prefer-hardware'` (which Chromium treats as "GPU or fail") every case up to nine decoders at once still works and gives the same numbers, so the app's `no-preference` gets the GPU decoder for all of them. The decoder pool I worried about isn't what runs out first; the decoder's throughput is. Uncapped speed follows the total number of pixels decoded per frame almost exactly: about 1.9–2.0 gigapixels per second, whether that's four big overlays or eight medium ones. Seeks add roughly 20–25 ms per big overlay, because every source seeks from its own keyframe.

#### Decisions for 3b

- **At most 4 video layers playing at the same time.** Four full-size layers play at 30 fps with more than 3× headroom and export at about 100 fps (a 60 s clip in about 20 s instead of 8). Six still play, but frames start running late, and on a slower card they would drop. Paused seeks with four big layers take 110–195 ms, slower than the 100 ms I aimed for in Phase 0, but they only happen when you click or scrub, and the main video still lands first.
- **Overlay working files fit inside the 1080×1920 output frame**, not "1920 on the longer side" as the plan said. The export is 1080 wide, so a landscape overlay never needs more than 1080 columns; at 1080×608 its stacked file has a third of the pixels of the 1920-wide one, and decoding cost is all about pixels. A full-screen vertical overlay stays at 1080×1920 and costs the same as a 1920-wide one, which the table covers.
- **Stacked layout:** colour straight as the file has it; alpha as luma in the bottom half; each half `ceil((height + 2) / 16) × 16` rows, padded with black. The shader reads alpha as BT.709 luma, clamps rows to each half's content so linear filtering never crosses the seam, and premultiplies itself.
- **Conversion:** a YUV filter graph (`extractplanes=a`, no RGBA round trip) and x264 with the working-file settings. VP8/VP9 files with `alpha_mode=1` are decoded with libvpx.
- **Alpha detection:** `alpha_mode=1` on the stream, or an alpha channel in the first decoded frame's `pix_fmt`. The stream's `pix_fmt` alone misses HEVC with alpha.
- GIF works, with on/off transparency; animated WebP, APNG, ProRes 4444, QuickTime Animation, PNG-in-MOV and HEVC with alpha all keep smooth alpha.

## Phase 4 checks

Before building speaker tracking I wanted to know three things: whether we can tell voices apart without Python, well enough to lean on; whether head tracks in a wide shot can be made stable; and whether the same person can be recognised in a close-up and in a wide two-shot. Everything here runs on the four Phase 0 clips. There's no full episode yet, so the hour-long timing uses repeated audio. Scripts are in `voices/` and `faces/track.ts`, `faces/appearance.ts`.

### Telling voices apart (4a)

[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 2.0.1 (`sherpa-onnx-node`, Apache-2.0) has a prebuilt Windows x64 addon. It loads in an Electron 45 utility process in about 0.3 s and diarizes clip B there in 6 s, same as in plain Node. The addon is N-API, so the Electron version doesn't matter.

I tried two ways:

- **sherpa's own pipeline:** pyannote segmentation 3.0 (MIT) finds the speech and the speaker changes, a speaker embedding model describes each piece, and sherpa clusters them.
- **Pieces from the transcript:** whisper already knows where every word is. Words are joined into pieces, split at pauses of 0.3 s or more and at 3 s. sherpa only computes an embedding per piece, and we cluster them ourselves (average linkage on cosine distance). Pieces of at least 1 s decide the clusters; shorter ones join the nearest.

Six embedding models were compared: 3D-Speaker CAM++ (VoxCeleb), CAM++ (Chinese and English, "advanced"), ERes2Net (VoxCeleb), all Apache-2.0; WeSpeaker ResNet34-LM and CAM++-LM, NeMo TitaNet-small, all CC BY 4.0.

The reference:

- clip D: the maintainer's transcript tagged A/M, aligned to whisper's words; 31 turns, many under 2 s;
- clip C: the speaker labels;
- clips A and B: one speaker wherever the transcript has words;
- "all 5": the four clips joined, 266 s with five people talking, which stands in for a longer recording.

The score is the share of speech, on 10 ms frames, given to the right voice when every voice maps to at most one person. 0.25 s around every reference boundary is left out. Speech that got no voice at all counts as wrong, and the share of it is in brackets.

| Method, model, setting | Clip D (2 people) | All 5 | Clips A / B / C (1 person) | Voices found, D / all 5 | Speed |
|---|---|---|---|---|---|
| sherpa pipeline, CAM++ VoxCeleb, told the count | 64% | 48% | 88 / 97 / 97% | 2 / 5 | 12–20× |
| sherpa pipeline, ERes2Net, told the count | 83% | 84% | | 2 / 5 | 7–9× |
| sherpa pipeline, CAM++ zh-en, threshold 0.7 | 80% | 74% | | 3 / 10 | 17× |
| **transcript pieces, CAM++ zh-en, threshold 0.7** | **93% (4% missed)** | **83% (7%)** | **94 / 88 / 89%** | **2 / 6** | **~100×** |
| transcript pieces, CAM++ zh-en, told the count | 93% | 83% | 94 / 90 / 91% | 2 / 5 | ~100× |
| transcript pieces, ERes2Net, threshold 0.7 | 93% | 64% | 94 / 90 / 61% | 2 / 9 | ~70× |

What the numbers show:

1. **sherpa's own pipeline fails on fast exchanges.** On clip D pyannote keeps one voice "on" for the first 56 s and puts the other one's short turns on top of it. Telling it the count doesn't help much (64–83%), and it is 5–10× slower because it runs the segmentation model over every second of audio.
2. **The transcript does the segmentation better.** Pieces cut at pauses rarely span a speaker change. CAM++ zh-en then gets clip D right 93% of the time without being told how many people there are. Of the speech it did label, 97% is right; the 4% it missed is speech with no words in the transcript.
3. **The threshold of 0.7 works without knowing the count.** It gives the right count on clip D and one voice too many on the joined file. A loud wide shot (clip C) and a 360p broadcast (clip B) split into two voices: 88–89% on the main one, and a merge brings them to 90–91%. Lower thresholds split everyone into many voices, higher ones (0.8) lump different people together, which is worse.
4. **Piece size matters.** Pauses of 0.1–0.2 s make pieces too short to describe a voice; 0.3 s was best for every model.
5. **It is fast.** An hour of audio in 1.6 s pieces takes 45 s with 4 threads (81× real time) and 64 s with 2, with other work running at the same time. That is about 780 MB of memory, 230 MB of it the hour of audio as float samples. Clustering 2250 pieces needs an O(n²) algorithm (not the naive one in the spike), about one second.

### Heads in a wide shot

`faces/track.ts` reruns tracking on the head boxes the face lab saved.

**Tracker.** The new tracker:

- matches heads by centre distance relative to head size instead of box overlap;
- keeps a track for 2 s without detections;
- joins tracks that end and start near each other;
- drops tracks under 0.5 s;
- smooths with a centred ±0.5 s window.

On clip C it gives 13 tracks instead of 101, 3 of them longer than 5 s. That's still too many. The pose model misses the man on the left (in profile, with a cap) in about three frames out of four, so his track keeps breaking up.

**Seats.** People in a podcast stay in their seats. Grouping every head detection in a shot by position, with the closest seat within 1.2 head sizes (1.6 in the app, see below) and a seat counting only if found in 15% of the shot's frames, gives:

- clip C: exactly 2 seats (one found in 555 frames, the other in 106);
- clip D: 1 seat in each close-up, 2 in the two-shot, and 3 in one shot that is a dissolve between two angles;
- clips A and B: 1 seat in every shot.

**Jitter.** Smoothing cuts frame-to-frame jitter from 2–10% of head size to 1–2%.

### The same person across camera angles

`faces/appearance.ts` describes each seat in clip D by the colours under the head (hue, saturation and brightness histograms, averaged over the shot). It then clusters the seats into two people, never joining two seats of the same shot.

The results are 11 of 16 seats right, and 1 of 2 in the two-shot, which is the case that matters. The two men are told apart in close-ups by a dark and a light top. In the two-shot their heads are 38 px tall and the lower-third banner covers their chests. Same-person and different-person distances overlap (0.17 vs 0.25 on average). Clothing colour won't carry identity from a close-up into a wide shot on this footage. A face recognition model would, but the common ones (InsightFace) aren't licensed for redistribution.

#### Decisions for Phase 4

- **Voices come from the transcript**, not from sherpa's pipeline:
  - pieces split at 0.3 s pauses and at 3 s;
  - 3D-Speaker CAM++ zh-en embeddings (28 MB, Apache-2.0) through `sherpa-onnx-node`;
  - average-linkage clustering at a cosine distance of 0.7, with a "number of people" setting that switches to a fixed count.

  This has two practical effects. Diarization can only run after transcription, which it does anyway. The pyannote segmentation model isn't needed, so the bundle is about 50 MB (addon plus one model) instead of 70.
- **Voices are reliable enough to be the main signal** in shots with several people: 93% on the one real two-person clip, against the 80% threshold set in the plan. The user can merge voices that got split, which is how a noisy recording usually goes wrong.
- **People are seats, per shot**, not free-moving tracks. The tracker fills in the frames in between and smooths. A seat found in less than 15% of a shot is dropped.
- **No identity across camera angles.**
  - In a close-up the person shown is the one to follow (the director's cut).
  - In a shot with several people, the link between a voice and a seat comes from the user's click and then holds for the rest of the episode.
  - Until there is a click, a two-person shot falls back to Split.
- Dissolves still need to be merged into one cut (clip D's 3-seat shot).

### A whole episode

The maintainer added one full episode: 42 minutes, 720p. Nearly all of the speech is one person; three other people talk for about 2 minutes between them. `voices/episode.ts` runs it the way the app will:

1. 16 kHz audio.
2. Transcript with large-v3-turbo q5_0 and DTW: 334 s on the GTX 1660, 4888 words.
3. 924 pieces: embeddings in 20 s (125× real time), clustering in 0.1 s.

| Threshold | 0.5 | 0.6 | 0.65–0.8 |
|---|---|---|---|
| Voices | 23 | 8 | 4 |
| Voices with 30 s or more | 6 | 4 | 3 |

At 0.7:

- **The main speaker is one voice for the whole 42 minutes** (34:41 of speech). Over-splitting the main speaker was the thing most likely to go wrong over an hour.
- **One of the other people** (1:02 of speech) is a voice of their own.
- **The other two** share a third voice, about 1 minute in total.
- A fourth voice has 3 s.

The count holds still from 0.65 to 0.8: the next merge after 0.65 is at 0.85.

This shows the threshold doesn't fall apart over an hour, and that the timing holds on real audio. It doesn't show two or more regular speakers over an hour, because this episode doesn't have them.

### People and cuts in the app (4a)

MediaPipe works in a Web Worker of the sandboxed renderer, with the GPU delegate on WebGL 2 for both Pose and the Face Landmarker. It has to be a classic worker. As a module, MediaPipe imports its WASM glue only once, and the second task fails with "ModuleFactory not set". A classic worker loads the glue again with `importScripts` for each task.

The app decodes the working file with its own WebCodecs decoder. Every frame gets a 32×18 thumbnail for the cuts, and every third frame (10 per second) goes to the worker at up to 1920 px wide.

| Clip | Working file | Analysis | Shots | Seats |
|---|---|---|---|---|
| C, wide shot | 64 s, 720p | 21 s | 1 | 2 (the man on the left found in 315 frames, against 106 in the spike's lab) |
| D, multi-camera | 80 s, 480p | 27 s | 10 (each dissolve one cut, where the lab had 16) | 1 per close-up, 2 in the two-shot |

Pose runs in VIDEO mode, which follows people from one frame to the next. Looking at each frame alone (IMAGE mode) found the man on the left in clip C in 100 frames instead of 315. VIDEO mode would also carry heads across a cut, though, so the page asks for a fresh Pose landmarker after every cut and at the start of every clip. That costs about 0.6 s per cut: clip D takes 27 s instead of 21.

In the two-shot, the man on the left first came out as two seats. He leans, and his 32 px head moved 1.5 head sizes. A seat now reaches 1.6 head sizes instead of 1.2; two people sitting side by side are much further apart than that.

### Who to look at (4b)

`faces/who.ts` runs the app's `stretchesOf` on the analysis of clips C and D, with voices from the transcript pieces, and scores the shots with several people against the speaker labels. A click is simulated in the first turn of a voice that falls in such a shot.

| Clip | Speech in such shots | No click | One click | One click per voice | Head size | Mouth measured |
|---|---|---|---|---|---|---|
| C, wide shot | 52 s | undecided 100% | right 96% | right 100% (2 clicks) | 31 and 55 px | 0% of the speech |
| D, the two-shot | 5 s | undecided 100% | right 100% | right 100% (2 clicks) | 33 and 38 px | 0% of the speech |

- **A click is what decides these shots.** Nothing else knows who is who, and one click carries over to the rest of the clip.
- **This is thin evidence.** Nearly all of the speech in clip C is one person, split into two voices, and clip D's two-shot is 5 s. Neither shows a real back-and-forth in a wide shot over minutes.
- **Lips are out of 4b.** The plan had them as a tie-breaker in shots with several people, but in both clips the heads are too small for the Face Landmarker: not one turn had enough mouth measurements to compare. In close-ups they aren't needed, since there's one person to look at.

### Automatic framing (4c)

`faces/frame.ts` runs `autoFrame` on the same analysis, voices and simulated clicks. It counts how often the head of the person talking is in the picture, in shots with several people.

| Clip | Clicks | Person talking in the picture | Keyframes per minute | Layouts |
|---|---|---|---|---|
| C, wide shot | 2 | 100% | 15 | Follow throughout |
| C, wide shot | 0 | 100% | 21 | Split throughout |
| D, multi-camera | 2 | 100% | 28 | Follow, Split in the two-shot, Follow |
| D, multi-camera | 0 | 100% | 28 | Follow, Split in the two-shot, Follow |

- **Keyframes go at the ends of a move.** Smooth keyframes stop at each key, so a path simplified the usual way (Ramer–Douglas–Peucker) gave a stop-and-go move, 13 keys for one lean. A key where the camera starts moving and one where it stops plays back as one motion.
- **Wide shots run out of pixels.** In clip C's 720p wide shot a head of 31 px asks for a crop about 100 px wide, more than 10× blown up. Zoom now stops at 5× and both halves of Split share one zoom, which also hides that the pose model sizes a head in profile too small.
- **The width setting does little on these clips.** The median zoom on clip C is 1.88, 1.88 and 1.83 for Tight, Medium and Wide, held back by the 5× limit. On clip D it is 1 for all three, because a 9:16 crop of a 480p close-up is already as tight as asked. It should matter more on sharper sources, which these clips can't show.
- **In the picture isn't the same as well framed.** The numbers show nobody gets lost; only watching the result shows whether it looks right.

### The preview while the analysis runs

On CI the clip tests failed because reading the preview back stalled while the analysis started. So I measured it in the app on clips C and D, on the GTX 1660, with the clip playing: gaps between animation frames over 60 ms, and how long reading a row of the preview took (clip D only).

| Situation | Gaps over 60 ms | Longest read of the preview |
|---|---|---|
| First analysis on a new install | 4–6, 1.5–2 s in all | up to 0.9 s |
| First clip after restarting the app | 0 | 12 ms |

- **It happens once.** All the gaps come in the seconds before the first detection. That fits MediaPipe compiling its GPU shaders, which the disk cache then saves, though I didn't prove that separately. A driver update may bring it back; I didn't check.
- **Camera cuts don't stall the preview.** Clip D has 10 shots, and after the start there was no gap over 60 ms, even with a fresh Pose landmarker at each cut.
- **CI is always a new install**, and it has no GPU, so it gets this on every run. The clip tests now wait for the analysis to finish.
- **Starting earlier didn't help.** I tried starting MediaPipe when the clip opens, with a warm-up detection, and not rebuilding Pose when nobody was being followed. The stall stayed at about 2 s and the analysis got 1–2 s shorter, because the working file is ready too soon for the two to overlap. Starting it when a project opens might hide the stall, but everyone would then pay in GPU and memory to save 2 s once per install, so I left it.

#### Still open

- An episode with two or more people talking throughout.
- A wide shot with a real back-and-forth, to count how many clicks it takes.
- Captions sit on the lower face in Split, where their default place falls.

## Phase 5 checks

### Finding pauses (5a)

The plan was to cut gaps between words that are also quiet. `silence/gaps.ts` measures those gaps on the four Phase 0 clips, with words as the app makes them and loudness as the highest sample in each 10 ms.

| Clip | Gaps of 0.5 s or more | Share of the clip | Of those, quiet at -26 dB under speech |
|---|---|---|---|
| A | 19 | 31% | 3 |
| B | 23 | 33% | 0 |
| C | 20 | 22% | 1 |
| D | 24 | 24% | 0 |

Word times can't find pauses. A quarter to a third of each clip looks like a gap, and almost none of it is quiet. At those gaps the sound runs on 0.41 s after a word's end (median; 0.80 s at the 95th percentile) and starts 0.26 s before the next word's start (0.88 s). Word ends run early, so a cut in such a gap would take the end of a word with it.

`silence/quiet.ts` turns it around and looks for quiet in the sound alone: RMS over 20 ms, with a limit set per clip between its noise floor and its speech level, since those differ a lot between clips (a range of 26 to 65 dB).

| Clip | Pauses of 0.5 s or more, limit at 0.35 of the range | Time | Share of the clip | Under words |
|---|---|---|---|---|
| A | 4 | 5.7 s | 11% | 0% |
| B | 13 | 14.0 s | 20% | 18% |
| C | 1 | 0.5 s | 1% | 0% |
| D | 4 | 2.9 s | 4% | 0% |

- **Pauses come from the sound.** Words only make sure no word is cut: clip B has words over quiet stretches, so a pause is what's left of a quiet stretch after taking the words out of it.
- **The limit isn't critical.** 0.25 to 0.5 of the range gives about the same pauses on clips A, B and D. Clip C, a loud wide shot with a floor of -41 dB, finds 0 to 4.
- **Some clips have little to cut.** Clips C and D are people talking fast, so they lose 1 to 4%. That's the right answer, not a miss.
- **Air can be small.** Since a pause's edges are where the sound really stops, 0.1 s on each side is enough.

### Going over a cut in the preview (5a)

The decoder has to start again from a keyframe at each cut, up to 14 frames before the one it needs. On the GTX 1660, with a 720p test clip playing over two cuts, the picture stood still for 32 and 42 ms: about one frame. That can't be seen, so playback jumps and doesn't need to decode through short cuts. The sound doesn't wait, since it's scheduled ahead.
