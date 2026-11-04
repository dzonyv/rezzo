/** The open clip's "who to look at", from its analysis, the voices and the user's picks. */
import { useMemo } from 'react';
import { stretchesOf, type Stretch } from '../../../shared/speakers.ts';
import { useAnalysis } from '../analysis/store.ts';
import { useProject } from '../project/store.ts';
import { useHeardVoices } from '../project/voices.ts';

const none: Stretch[] = [];

export function useStretches(): Stretch[] {
  const analysis = useAnalysis((s) => s.analysis);
  const turns = useHeardVoices()?.turns;
  const picks = useProject((s) => s.project?.voices.picks);
  return useMemo(() => (analysis ? stretchesOf(analysis, turns ?? [], picks ?? []) : none), [analysis, turns, picks]);
}
