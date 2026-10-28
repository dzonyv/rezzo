/**
 * Active-speaker accuracy against the maintainer's labels.
 *
 *   node faces/speakers.ts [--check-identity]
 *
 * Reads <media>/whisper/review/<clip>.speakers.txt (Audacity labels: start,
 * end, who) and the face lab output for the same clip, then for every frame
 * where exactly one labelled person talks, compares three guesses:
 *
 *   mouth    the head whose mouth opening varies most around that moment
 *   largest  the biggest head in frame (what a naive "follow" would do)
 *   onlyOne  in a single-person shot, the person shown (the director's cut)
 *
 * Who is who comes from the clip's identity rule in <media>/clips.json
 * (position in a wide shot, shirt colour in the multi-camera clip). These
 * rules only fit these test clips; the app will need real identity tracking.
 *
 * --check-identity prints the identity rule's decision every 4 s so it can
 * be compared with the clip by eye.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { mediaDir } from '../shared/paths.ts';
import { ffmpegExe } from '../shared/tools.ts';
import { audioPath, DRAFT_MODEL, listClips, reviewDir, runsDir, type Clip } from '../whisper/clips.ts';
import { align, normalize, SPEAKER_TAG } from '../whisper/metrics.ts';
import { wordsOf, type WhisperJson } from '../whisper/words.ts';

interface Head {
  id: number;
  box: { x: number; y: number; w: number; h: number };
  landmarks: boolean;
  mouthOpen: number | null;
}
interface Frame {
  t: number;
  cut: boolean;
  heads: Head[];
}
interface Lab {
  width: number;
  height: number;
  fps: number;
  frames: Frame[];
}

const THUMB_W = 160;

/** Small RGB frames at the lab's rate, for the shirt-colour rule. */
function thumbnails(file: string, fps: number, w: number, h: number): Promise<Buffer[]> {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegExe(), ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', `fps=${fps},scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    const chunks: Buffer[] = [];
    ff.stdout.on('data', (c: Buffer) => chunks.push(c));
    ff.on('error', reject);
    ff.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with ${code}`));
      const all = Buffer.concat(chunks);
      const size = w * h * 3;
      resolve(Array.from({ length: Math.floor(all.length / size) }, (_, i) => all.subarray(i * size, (i + 1) * size)));
    });
  });
}

type Identify = (head: Head, frame: number) => string | undefined;

async function identityRule(clip: Clip, lab: Lab): Promise<Identify | undefined> {
  const rule = clip.identity;
  if (rule?.rule === 'seat') {
    // Wide shot, nobody moves seats: left half or right half of the frame.
    return (head) => (head.box.x + head.box.w / 2 < lab.width / 2 ? rule.left : rule.right);
  }
  if (rule?.rule === 'shirt') {
    // One person wears a dark top, the other a light one: look at the chest
    // right under the chin. Further down is the channel's lower-third
    // banner, which is dark for both.
    const th = Math.round((THUMB_W * lab.height) / lab.width);
    const frames = await thumbnails(clip.file, lab.fps, THUMB_W, th);
    const s = THUMB_W / lab.width;
    return (head, i) => {
      // In the wide two-shot the clothes are too small to tell apart, but
      // the seating doesn't change.
      const others = lab.frames[i]?.heads ?? [];
      if (others.length >= 2) {
        const leftmost = others.reduce((a, b) => (b.box.x < a.box.x ? b : a));
        const otherOne = rule.twoShotLeft === rule.dark ? rule.light : rule.dark;
        return head === leftmost ? rule.twoShotLeft : otherOne;
      }
      const img = frames[i];
      if (!img) return undefined;
      const x0 = Math.max(0, Math.round((head.box.x + head.box.w * 0.2) * s));
      const x1 = Math.min(THUMB_W, Math.round((head.box.x + head.box.w * 0.8) * s));
      const y0 = Math.min(th, Math.round((head.box.y + head.box.h * 1.0) * s));
      const y1 = Math.min(th, Math.round((head.box.y + head.box.h * 1.4) * s));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const p = (y * THUMB_W + x) * 3;
          sum += (img[p] + img[p + 1] + img[p + 2]) / 3;
          n++;
        }
      }
      if (n === 0) return undefined;
      return sum / n > 100 ? rule.light : rule.dark;
    };
  }
  return undefined;
}

interface Label {
  start: number;
  end: number;
  who: string;
}

const parseLabels = (text: string): Label[] =>
  text
    .split(/\r?\n/)
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3 && c[2].trim())
    .map((c) => ({ start: Number(c[0]), end: Number(c[1]), who: c[2].trim().toUpperCase()[0] }));

/**
 * Speaker turns from a corrected transcript whose lines start with a tag
 * ("A: ...", "M: ..."). The lines carry no times, so the transcript is
 * aligned word by word with the draft model's output: each line spans from
 * its first to its last word that found a match.
 */
async function labelsFromTranscript(clip: Clip): Promise<Label[] | undefined> {
  const refPath = path.join(reviewDir, `${clip.id}.txt`);
  if (!existsSync(refPath)) return undefined;
  const lines = (await readFile(refPath, 'utf8'))
    .split(/\r?\n/)
    .map((line) => ({ who: line.match(SPEAKER_TAG)?.[1], words: normalize(line.replace(SPEAKER_TAG, '')) }));
  if (!lines.some((l) => l.who)) return undefined;

  const ref = lines.flatMap((l, li) => l.words.map((w) => ({ w, li })));
  const draft = JSON.parse(await readFile(path.join(runsDir(clip), `${DRAFT_MODEL}__${clip.lang}.json`), 'utf8')) as WhisperJson;
  const hyp = wordsOf(draft)
    .map((w) => ({ w: normalize(w.text)[0], start: w.startDtw ?? w.start, end: w.end }))
    .filter((h) => h.w);

  const spans = new Map<number, { start: number; end: number }>();
  let i = 0;
  let j = 0;
  for (const op of align(ref.map((r) => r.w), hyp.map((h) => h.w))) {
    if (op.kind === 'ins') {
      j++;
      continue;
    }
    if (op.kind === 'del') {
      i++;
      continue;
    }
    const li = ref[i].li;
    const span = spans.get(li);
    spans.set(li, { start: Math.min(span?.start ?? Infinity, hyp[j].start), end: Math.max(span?.end ?? -Infinity, hyp[j].end) });
    i++;
    j++;
  }
  return [...spans.entries()]
    .filter(([li]) => lines[li].who)
    .map(([li, s]) => ({ start: s.start, end: s.end, who: lines[li].who! }));
}

/** Audio loudness (RMS) per lab frame, from whisper's 16 kHz mono WAV. */
async function loudness(clip: Clip, fps: number): Promise<number[]> {
  const wav = await readFile(audioPath(clip));
  const samples = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
  const step = 16000 / fps;
  const out: number[] = [];
  for (let k = 0; k * step < samples.length; k++) {
    let sum = 0;
    const end = Math.min(samples.length, (k + 1) * step);
    for (let s = k * step; s < end; s++) sum += samples[s] * samples[s];
    out.push(Math.sqrt(sum / (end - k * step)));
  }
  return out;
}

/**
 * Pearson correlation between a head's mouth opening and the audio loudness
 * within ±1 s: a talking mouth opens and closes with the sound, a laughing or
 * nodding listener's doesn't.
 */
function avCorrelation(frames: Frame[], loud: number[], i: number, id: number, fps: number): number | undefined {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let j = Math.max(0, i - fps); j <= Math.min(frames.length - 1, i + fps); j++) {
    const h = frames[j].heads.find((x) => x.id === id);
    if (h?.mouthOpen != null && loud[j] !== undefined) {
      xs.push(h.mouthOpen);
      ys.push(loud[j]);
    }
  }
  if (xs.length < 8) return undefined;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let k = 0; k < xs.length; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
    syy += (ys[k] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : undefined;
}

/** Standard deviation of each head track's mouth opening within ±0.4 s. */
function mouthActivity(frames: Frame[], i: number, id: number, fps: number): number | undefined {
  const r = Math.round(0.4 * fps);
  const values: number[] = [];
  for (let j = Math.max(0, i - r); j <= Math.min(frames.length - 1, i + r); j++) {
    const h = frames[j].heads.find((x) => x.id === id);
    if (h?.mouthOpen != null) values.push(h.mouthOpen);
  }
  if (values.length < 3) return undefined;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

async function evaluate(clip: Clip, checkIdentity: boolean) {
  const labPath = path.join(mediaDir, 'faces', `${clip.id}.json`);
  if (!existsSync(labPath)) return undefined;
  const lab = JSON.parse(await readFile(labPath, 'utf8')) as Lab;
  const identify = await identityRule(clip, lab);
  if (!identify) return undefined;

  if (checkIdentity) {
    const marks = lab.frames
      .filter((_, i) => i % (4 * lab.fps) === 0)
      .map((f) => `${f.t}s:${f.heads.map((h) => identify(h, lab.frames.indexOf(f)) ?? '?').join('') || '-'}`);
    console.log(`${clip.id}: ${marks.join(' ')}`);
  }

  const labelsPath = path.join(reviewDir, `${clip.id}.speakers.txt`);
  const labels = existsSync(labelsPath)
    ? parseLabels(await readFile(labelsPath, 'utf8'))
    : await labelsFromTranscript(clip);
  if (!labels) {
    console.log(`${clip.id}: no speaker labels yet`);
    return undefined;
  }

  const tally = {
    frames: 0,
    mouth: { guessed: 0, right: 0 },
    largest: { guessed: 0, right: 0 },
    onlyOne: { guessed: 0, right: 0 },
    // The case that matters for choosing between people: both in frame.
    mouthTwoInFrame: { guessed: 0, right: 0 },
  };
  // Single-person shots: is the person shown talking or listening?
  const shown: { activity: number; talking: boolean }[] = [];
  const shownAv: { activity: number; talking: boolean }[] = [];
  const loud = await loudness(clip, lab.fps);
  lab.frames.forEach((frame, i) => {
    const talking = [...new Set(labels.filter((l) => frame.t >= l.start && frame.t < l.end).map((l) => l.who))];
    if (talking.length !== 1) return;
    const truth = talking[0];
    tally.frames++;
    const score = (key: 'mouth' | 'largest' | 'onlyOne' | 'mouthTwoInFrame', head: Head | undefined) => {
      if (!head) return;
      tally[key].guessed++;
      if (identify(head, i) === truth) tally[key].right++;
    };

    let best: { head: Head; activity: number } | undefined;
    for (const head of frame.heads) {
      const a = mouthActivity(lab.frames, i, head.id, lab.fps);
      if (a !== undefined && (!best || a > best.activity)) best = { head, activity: a };
    }
    score('mouth', best?.head);
    score('largest', [...frame.heads].sort((p, q) => q.box.h - p.box.h)[0]);
    score('onlyOne', frame.heads.length === 1 ? frame.heads[0] : undefined);
    if (frame.heads.length >= 2) score('mouthTwoInFrame', best?.head);
    if (frame.heads.length === 1 && best) shown.push({ activity: best.activity, talking: identify(best.head, i) === truth });
    if (frame.heads.length === 1) {
      const c = avCorrelation(lab.frames, loud, i, frame.heads[0].id, lab.fps);
      if (c !== undefined) shownAv.push({ activity: c, talking: identify(frame.heads[0], i) === truth });
    }
  });

  // Best single threshold on mouth activity for "the person shown is talking",
  // against always answering the more common case.
  const separate = (shown: { activity: number; talking: boolean }[]) => {
    if (shown.length === 0) return undefined;
    const talkingShare = shown.filter((s) => s.talking).length / shown.length;
    let bestAcc = 0;
    let bestThreshold = 0;
    for (const { activity: t } of shown) {
      const acc = shown.filter((s) => (s.activity >= t) === s.talking).length / shown.length;
      if (acc > bestAcc) [bestAcc, bestThreshold] = [acc, t];
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
    return {
      frames: shown.length,
      shownPersonTalking: `${(100 * talkingShare).toFixed(0)}%`,
      meanActivity: { talking: +mean(shown.filter((s) => s.talking).map((s) => s.activity)).toFixed(4), listening: +mean(shown.filter((s) => !s.talking).map((s) => s.activity)).toFixed(4) },
      bestThresholdAccuracy: `${(100 * bestAcc).toFixed(0)}%`,
      threshold: +bestThreshold.toFixed(4),
    };
  };
  const talkingVsListening = { mouthMovement: separate(shown), mouthFollowsSound: separate(shownAv) };

  const fmt = (x: { guessed: number; right: number }) => ({
    coverage: `${((100 * x.guessed) / tally.frames).toFixed(0)}%`,
    accuracy: x.guessed ? `${((100 * x.right) / x.guessed).toFixed(0)}%` : '–',
  });
  const result = {
    clip: clip.id,
    singleSpeakerFrames: tally.frames,
    mouth: fmt(tally.mouth),
    largest: fmt(tally.largest),
    onlyOne: fmt(tally.onlyOne),
    mouthTwoInFrame: fmt(tally.mouthTwoInFrame),
    talkingVsListening,
  };
  console.log(JSON.stringify(result));
  return result;
}

const { values } = parseArgs({ options: { 'check-identity': { type: 'boolean', default: false } } });
const results = [];
for (const clip of listClips()) {
  const r = await evaluate(clip, values['check-identity']);
  if (r) results.push(r);
}
if (results.length) await writeFile(path.join(mediaDir, 'faces', 'speakers.json'), JSON.stringify(results, null, 2));
