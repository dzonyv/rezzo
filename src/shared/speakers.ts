/**
 * Who to look at, moment by moment in a clip. The order comes from Phase 0
 * and the Phase 4 checks (spikes/REPORT.md):
 *
 * 1. One person in the shot: them. The director chose.
 * 2. Several people: the one the voice talking belongs to. Only the user can
 *    say who that is, since nothing tells the same person apart across
 *    camera angles: a click in one turn holds for that turn, and teaches
 *    where the voice sits for the rest of the episode.
 * 3. Nobody talking: whoever was being looked at stays on.
 *
 * Until a voice has been placed, a shot with several people is a "group",
 * which automatic framing shows as Split.
 */
import { centreOf, sizeOf } from './heads.ts';
import type { ClipAnalysis, Seat } from './analysis.ts';
import { voiceAt, type SpeakerPick, type VoiceTurn } from './voices.ts';

/** A place is on a seat this many head sizes from the seat's centre. */
const PLACE_REACH = 1.6;
/** Heads further apart in size than this are from different camera angles, where a place means nothing. */
const SAME_ANGLE = 1.5;

export type Target =
  /** Why: alone in the shot, picked here, where the voice sits, the only seat left once the other voices are placed, or still on them in a pause. */
  | { kind: 'seat'; seat: number; why: 'alone' | 'pick' | 'place' | 'left' | 'held' }
  /** Several people and no telling which. */
  | { kind: 'group' }
  /** No one in the shot. */
  | { kind: 'none' };

/** A stretch of the clip with one target: a turn within a shot, a pause, or a whole shot with at most one person. */
export interface Stretch {
  start: number;
  end: number;
  /** Which of the analysis's shots it's in. */
  shot: number;
  /** Whose turn it is; null in a pause, and where it makes no difference. */
  voice: number | null;
  target: Target;
  /** The pick that decided it, if one did. */
  pick: SpeakerPick | null;
}

interface Place extends Omit<SpeakerPick, 't'> {
  voice: number;
}

/**
 * Where each voice sits, from the picks, oldest first. Only a pick during a
 * turn says that: in a pause the person clicked may be about to answer the
 * voice that just stopped.
 */
function placesOf(turns: readonly VoiceTurn[], picks: readonly SpeakerPick[]): Place[] {
  return picks.flatMap(({ t, ...place }) => {
    const voice = voiceAt(turns, t);
    return voice === null ? [] : [{ voice, ...place }];
  });
}

/** The seat a place is on, if any: near enough, with a head of about the same size. */
function seatAt(seats: readonly Seat[], place: Omit<Place, 'voice'>, analysis: ClipAnalysis): Seat | undefined {
  let best: Seat | undefined;
  let bestD = PLACE_REACH;
  for (const seat of seats) {
    const size = sizeOf(seat.box);
    const placeSize = place.size * analysis.width;
    if (Math.max(size, placeSize) / Math.min(size, placeSize) > SAME_ANGLE) continue;
    const c = centreOf(seat.box);
    const d = Math.hypot(c.x - place.x * analysis.width, c.y - place.y * analysis.height) / size;
    if (d < bestD) {
      bestD = d;
      best = seat;
    }
  }
  return best;
}

/** The seat most of a voice's places are on; a tie goes to the latest. */
function seatOfVoice(seats: readonly Seat[], places: readonly Place[], voice: number, analysis: ClipAnalysis): Seat | undefined {
  const votes = new Map<Seat, number>();
  let best: Seat | undefined;
  for (const place of places) {
    if (place.voice !== voice) continue;
    const seat = seatAt(seats, place, analysis);
    if (!seat) continue;
    const n = (votes.get(seat) ?? 0) + 1;
    votes.set(seat, n);
    if (!best || n >= votes.get(best)!) best = seat;
  }
  return best;
}

/** The target of a voice's turn in a shot with several people. */
function targetOfVoice(seats: readonly Seat[], places: readonly Place[], voice: number, analysis: ClipAnalysis): Target {
  const own = seatOfVoice(seats, places, voice, analysis);
  if (own) return { kind: 'seat', seat: own.id, why: 'place' };
  const others = new Set(places.filter((p) => p.voice !== voice).map((p) => p.voice));
  const taken = new Set([...others].map((v) => seatOfVoice(seats, places, v, analysis)));
  const free = seats.filter((s) => !taken.has(s));
  return taken.size > 0 && free.length === 1 ? { kind: 'seat', seat: free[0]!.id, why: 'left' } : { kind: 'group' };
}

/** A shot with several people, cut into its turns and the pauses between them. */
function stretchesOfShot(shot: { start: number; end: number }, turns: readonly VoiceTurn[]): { start: number; end: number; voice: number | null }[] {
  const out: { start: number; end: number; voice: number | null }[] = [];
  let from = shot.start;
  for (const turn of turns) {
    const start = Math.max(turn.start, from);
    const end = Math.min(turn.end, shot.end);
    if (end <= start) continue;
    if (start > from) out.push({ start: from, end: start, voice: null });
    out.push({ start, end, voice: turn.voice });
    from = end;
  }
  if (from < shot.end) out.push({ start: from, end: shot.end, voice: null });
  return out;
}

/** What a pause in a shot shows: who came before it, or at the start of the shot, who comes after. */
function heldTarget(parts: readonly { target: Target | null }[], i: number): Target {
  const near = parts.slice(0, i).findLast((p) => p.target)?.target ?? parts.slice(i).find((p) => p.target)?.target;
  return near?.kind === 'seat' ? { ...near, why: 'held' } : { kind: 'group' };
}

/** Who to look at from the start of the analysis to its end, in time order. */
export function stretchesOf(analysis: ClipAnalysis, turns: readonly VoiceTurn[], picks: readonly SpeakerPick[]): Stretch[] {
  const places = placesOf(turns, picks);
  return analysis.shots.flatMap((shot, s): Stretch[] => {
    const seats = analysis.seats.filter((seat) => seat.shot === s);
    if (seats.length === 0) return [{ ...shot, shot: s, voice: null, pick: null, target: { kind: 'none' } }];
    if (seats.length === 1) return [{ ...shot, shot: s, voice: null, pick: null, target: { kind: 'seat', seat: seats[0]!.id, why: 'alone' } }];

    const parts = stretchesOfShot(shot, turns).map((part) => {
      const pick = picks.findLast((p) => p.t >= part.start && p.t < part.end);
      const seat = pick && seatAt(seats, pick, analysis);
      if (pick && seat) return { ...part, shot: s, pick, target: { kind: 'seat', seat: seat.id, why: 'pick' } as Target };
      return { ...part, shot: s, pick: null, target: part.voice === null ? null : targetOfVoice(seats, places, part.voice, analysis) };
    });
    return parts.map((part, i) => ({ ...part, target: part.target ?? heldTarget(parts, i) }));
  });
}

/** The stretch at `t`; past the last one, the last one. */
export function stretchAt(stretches: readonly Stretch[], t: number): Stretch | null {
  return stretches.find((s) => t < s.end) ?? stretches.at(-1) ?? null;
}

/**
 * The stretch a click at `t` is about. Mostly the one at `t`, but a pause
 * that opens a shot has nobody before it to be about: the click means the
 * turn to come. That's where the playhead sits when a clip opens.
 */
export function clickedStretch(stretches: readonly Stretch[], t: number): Stretch | null {
  const stretch = stretchAt(stretches, t);
  if (!stretch || stretch.voice !== null) return stretch;
  const i = stretches.indexOf(stretch);
  const next = stretches[i + 1];
  return stretches[i - 1]?.shot !== stretch.shot && next?.shot === stretch.shot && next.voice !== null ? next : stretch;
}

/** Whether the user picked this seat for this stretch, so a click takes that back. */
export const isPicked = (stretch: Stretch, seat: number): boolean => stretch.pick !== null && stretch.target.kind === 'seat' && stretch.target.seat === seat;
