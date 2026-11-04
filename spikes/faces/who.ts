/**
 * How well "who to look at" (src/shared/speakers.ts) does in shots with
 * several people, against the maintainer's speaker labels.
 *
 *   node faces/who.ts
 *
 * Reads <media>/../phase4/clips/<clip>.analysis.json (the app's clip analysis
 * of a real clip) and the transcript-pieces voices from voices/words.ts. A
 * click is simulated by picking the right person in the first turn of a voice
 * that falls in such a shot. Lips are scored on their own: in each turn, the
 * seat whose mouth opening varies most.
 *
 * Scored on 10 ms frames where exactly one labelled person talks.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ClipAnalysis, Seat } from '../../src/shared/analysis.ts';
import { stretchAt, stretchesOf } from '../../src/shared/speakers.ts';
import { turnsOf, type SpeakerPick, type VoiceTurn } from '../../src/shared/voices.ts';
import { mediaDir } from '../shared/paths.ts';
import { listClips, reviewDir, type Clip } from '../whisper/clips.ts';
import { labelsFromTranscript, parseLabels, type Label } from './labels.ts';

const STEP = 0.01;

async function labelsOf(clip: Clip): Promise<Label[]> {
  return (await labelsFromTranscript(clip)) ?? parseLabels(await readFile(path.join(reviewDir, `${clip.id}.speakers.txt`), 'utf8'));
}

/** The labelled person alone at `t`, if exactly one talks. */
function whoAt(labels: readonly Label[], t: number): string | null {
  const now = new Set(labels.filter((l) => l.start <= t && t < l.end).map((l) => l.who));
  return now.size === 1 ? [...now][0]! : null;
}

/** Left seat is the first person of the clip's rule, right seat the other. */
function sidesOf(clip: Clip): [string, string] {
  const rule = clip.identity!;
  if (rule.rule === 'seat') return [rule.left, rule.right];
  return [rule.twoShotLeft, rule.twoShotLeft === rule.dark ? rule.light : rule.dark];
}

function mouthMovement(seat: Seat, start: number, end: number): number | null {
  const m = seat.samples.filter((s) => s.t >= start && s.t < end && s.mouth !== null).map((s) => s.mouth!);
  if (m.length < 5) return null;
  const mean = m.reduce((a, b) => a + b, 0) / m.length;
  return Math.sqrt(m.reduce((a, b) => a + (b - mean) ** 2, 0) / m.length);
}

for (const id of ['clip-c', 'clip-d']) {
  const clip = listClips().find((c) => c.id === id)!;
  const analysis = JSON.parse(await readFile(path.join(mediaDir, '..', 'phase4', 'clips', `${id}.analysis.json`), 'utf8')) as ClipAnalysis;
  const labels = await labelsOf(clip);
  const run = JSON.parse(await readFile(path.join(mediaDir, 'voices', 'runs', `${id}__campplus-zh-en__w0.3m3-t0.7.json`), 'utf8')) as { segments: { start: number; end: number; speaker: number }[] };
  const turns: VoiceTurn[] = turnsOf(run.segments, run.segments.map((s) => s.speaker));
  const [left, right] = sidesOf(clip);

  const multi = analysis.shots.flatMap((shot, s) => {
    const seats = analysis.seats.filter((seat) => seat.shot === s).sort((a, b) => a.box.x - b.box.x);
    return seats.length >= 2 ? [{ shot, seats }] : [];
  });
  const whoIs = (seatId: number) => {
    const m = multi.find((x) => x.seats.some((s) => s.id === seatId));
    return m ? (m.seats[0]!.id === seatId ? left : right) : null;
  };
  const inMulti = (t: number) => multi.find((m) => t >= m.shot.start && t < m.shot.end);

  /** Share of the labelled speech in such shots that lands on the right person, and what's left undecided. */
  const score = (picks: SpeakerPick[]) => {
    const stretches = stretchesOf(analysis, turns, picks);
    let total = 0;
    let right_ = 0;
    let undecided = 0;
    for (let t = analysis.start; t < analysis.end; t += STEP) {
      if (!inMulti(t)) continue;
      const who = whoAt(labels, t);
      if (!who) continue;
      total++;
      const target = stretchAt(stretches, t)!.target;
      if (target.kind !== 'seat') undecided++;
      else if (whoIs(target.seat) === who) right_++;
    }
    return { seconds: Math.round(total * STEP), right: Math.round((right_ / total) * 100), undecided: Math.round((undecided / total) * 100) };
  };

  /** One simulated click in the first turn of each voice, loudest voice first. */
  const clicks: SpeakerPick[] = [];
  const talk = new Map<number, number>();
  for (const v of turns) talk.set(v.voice, (talk.get(v.voice) ?? 0) + v.end - v.start);
  for (const voice of [...talk.keys()].sort((a, b) => talk.get(b)! - talk.get(a)!)) {
    for (const turn of turns.filter((v) => v.voice === voice)) {
      const t = (turn.start + turn.end) / 2;
      const m = inMulti(t);
      const who = whoAt(labels, t);
      if (!m || !who) continue;
      const seat = m.seats[who === left ? 0 : m.seats.length - 1]!;
      clicks.push({ t, x: (seat.box.x + seat.box.w / 2) / analysis.width, y: (seat.box.y + seat.box.h / 2) / analysis.height, size: seat.box.w / analysis.width });
      break;
    }
  }

  let lipsTotal = 0;
  let lipsMeasured = 0;
  let lipsRight = 0;
  for (const { shot, seats } of multi) {
    for (const turn of turns) {
      const start = Math.max(turn.start, shot.start);
      const end = Math.min(turn.end, shot.end);
      if (end <= start) continue;
      const a = mouthMovement(seats[0]!, start, end);
      const b = mouthMovement(seats.at(-1)!, start, end);
      for (let t = start; t < end; t += STEP) {
        const who = whoAt(labels, t);
        if (!who) continue;
        lipsTotal++;
        if (a === null || b === null) continue;
        lipsMeasured++;
        if ((a > b ? left : right) === who) lipsRight++;
      }
    }
  }

  const heads = multi.flatMap((m) => m.seats.map((s) => Math.round(s.box.w)));
  console.log(id, {
    shotsWithSeveral: multi.length,
    of: analysis.shots.length,
    headPx: heads,
    voices: talk.size,
    noClick: score([]),
    oneClick: score(clicks.slice(0, 1)),
    clickPerVoice: { clicks: clicks.length, ...score(clicks) },
    lips: { measured: Math.round((lipsMeasured / Math.max(1, lipsTotal)) * 100), right: lipsMeasured ? Math.round((lipsRight / lipsMeasured) * 100) : null },
  });
}
