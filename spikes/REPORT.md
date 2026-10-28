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
- **Export speed on real footage**: measured on a synthetic source that is very easy to encode. Re-check in Phase 1 with the first real export.
- **Bundle size**: the CUDA build of whisper.cpp is 685 MB zipped (285 MB for the CUDA 11.8 build, not yet tested). Licence-wise, its CUDA runtime DLLs fall under NVIDIA's EULA and ship as a separate program next to the GPL app; this needs a closer look before the first release.
- **Moving FFmpeg out of the renderer**: the spikes run Node in the renderer. The app will use a utility process, and the cost of passing 3.1 MB per frame between processes is not yet measured.
- **Head tracking in wide shots** jumps (101 track ids in 67 s) and needs smoothing in Phase 4.

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

- Speed on real 1080p footage (the synthetic picture is very easy to encode). Re-run once clips are in.
- Converting the source to the working file: timed on real clips in 0a/0b.
- In the spike the renderer runs Node directly. The app will keep the renderer sandboxed and move FFmpeg into a utility process. The cost of passing 3.1 MB per frame between processes still needs measuring.
