import type { ClipAnalysis, Seat } from '../../../shared/analysis.ts';
import { centreOf, sizeOf } from '../../../shared/heads.ts';
import { isPicked, type Stretch } from '../../../shared/speakers.ts';
import { pickSpeaker } from '../project/voices.ts';

/**
 * The user says this seat is the one talking in this stretch (see
 * clickedStretch). Saying it again about the one they already picked takes
 * it back. The pick records where the seat is on average, not where the head
 * is this moment, so someone clicked mid-lean still lands on their own seat.
 */
export function sayWhoTalks(stretch: Stretch, seat: Seat, analysis: ClipAnalysis, time: number): void {
  if (isPicked(stretch, seat.id)) {
    pickSpeaker(stretch.pick, null);
    return;
  }
  const c = centreOf(seat.box);
  const unit = (v: number) => Math.min(1, Math.max(0, v));
  pickSpeaker(stretch.pick, { t: Math.max(time, stretch.start), x: unit(c.x / analysis.width), y: unit(c.y / analysis.height), size: unit(sizeOf(seat.box) / analysis.width) });
}
