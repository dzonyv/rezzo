/**
 * How automatic framing (src/shared/autoframe.ts) does on real clips, with
 * one simulated click per voice as in faces/who.ts.
 *
 *   node faces/frame.ts
 *
 * Prints per clip and width: the share of the labelled speech where the head
 * of the person talking is in the picture (only counted in shots that show
 * them), the same with no clicks at all, and how many keyframes and layout
 * changes it takes.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { seatBoxAt, type ClipAnalysis } from '../../src/shared/analysis.ts';
import { autoFrame, FRAME_WIDTHS, withAutoFrame } from '../../src/shared/autoframe.ts';
import { defaultVideoLayer, frameRecipe } from '../../src/shared/framing.ts';
import type { FrameRate } from '../../src/shared/frames.ts';
import { centreOf } from '../../src/shared/heads.ts';
import { stretchesOf } from '../../src/shared/speakers.ts';
import { turnsOf, voiceAt, type SpeakerPick, type VoiceTurn } from '../../src/shared/voices.ts';
import { mediaDir } from '../shared/paths.ts';
import { listClips, reviewDir, type Clip } from '../whisper/clips.ts';
import { labelsFromTranscript, parseLabels, type Label } from './labels.ts';

const RATE: FrameRate = [30, 1];
const STEP = 0.02;

const labelsOf = async (clip: Clip): Promise<Label[]> => (await labelsFromTranscript(clip)) ?? parseLabels(await readFile(path.join(reviewDir, `${clip.id}.speakers.txt`), 'utf8'));

function whoAt(labels: readonly Label[], t: number): string | null {
  const now = new Set(labels.filter((l) => l.start <= t && t < l.end).map((l) => l.who));
  return now.size === 1 ? [...now][0]! : null;
}

for (const id of ['clip-c', 'clip-d']) {
  const clip = listClips().find((c) => c.id === id)!;
  const analysis = JSON.parse(await readFile(path.join(mediaDir, '..', 'phase4', 'clips', `${id}.analysis.json`), 'utf8')) as ClipAnalysis;
  const labels = await labelsOf(clip);
  const run = JSON.parse(await readFile(path.join(mediaDir, 'voices', 'runs', `${id}__campplus-zh-en__w0.3m3-t0.7.json`), 'utf8')) as { segments: { start: number; end: number; speaker: number }[] };
  const turns: VoiceTurn[] = turnsOf(run.segments, run.segments.map((s) => s.speaker));
  const rule = clip.identity!;
  const left = rule.rule === 'seat' ? rule.left : rule.twoShotLeft;
  const size = { width: analysis.width, height: analysis.height };
  const range = { start: analysis.start, end: analysis.end };

  const severalAt = (t: number) => {
    const s = analysis.shots.findIndex((shot) => t >= shot.start && t < shot.end);
    const seats = analysis.seats.filter((seat) => seat.shot === s);
    return seats.length > 1 ? seats : null;
  };

  const clicks: SpeakerPick[] = [];
  for (const voice of new Set(turns.map((v) => v.voice))) {
    for (const turn of turns.filter((v) => v.voice === voice)) {
      const t = (turn.start + turn.end) / 2;
      const seats = severalAt(t);
      const who = whoAt(labels, t);
      if (!seats || !who) continue;
      const seat = seats[who === left ? 0 : seats.length - 1]!;
      const c = centreOf(seat.box);
      clicks.push({ t, x: c.x / size.width, y: c.y / size.height, size: seat.box.w / size.width });
      break;
    }
  }

  const score = (picks: SpeakerPick[], width: (typeof FRAME_WIDTHS)[number]) => {
    const framed = autoFrame(analysis, stretchesOf(analysis, turns, picks), range, { width, change: 'cut' }, RATE);
    const layer = { ...defaultVideoLayer(0), ...withAutoFrame(defaultVideoLayer(0), framed, range, true, RATE) };
    let total = 0;
    let shown = 0;
    for (let t = range.start; t < range.end; t += STEP) {
      const seats = severalAt(t);
      const who = whoAt(labels, t);
      if (!seats || !who) continue;
      total++;
      const seat = seats[who === left ? 0 : seats.length - 1]!;
      const c = centreOf(seatBoxAt(seat, t));
      const x = c.x / size.width;
      const y = c.y / size.height;
      if (frameRecipe(layer, t, size).draws.some(({ src }) => x >= src.x && x <= src.x + src.w && y >= src.y && y <= src.y + src.h)) shown++;
    }
    const zooms = framed.follow.map((k) => k.value.zoom).sort((a, b) => a - b);
    const minutes = (range.end - range.start) / 60;
    return {
      talkerShown: Math.round((shown / Math.max(1, total)) * 100),
      keysPerMinute: Math.round((framed.follow.length + framed.splitTop.length + framed.splitBottom.length) / minutes),
      medianZoom: Math.round((zooms[zooms.length >> 1] ?? 1) * 100) / 100,
      layouts: framed.layout.map((k) => k.value).join(' '),
    };
  };

  console.log(id, { clicks: clicks.length });
  for (const width of FRAME_WIDTHS) console.log(' ', width, 'clicks', score(clicks, width));
  console.log('  medium no clicks', score([], 'medium'));
}
