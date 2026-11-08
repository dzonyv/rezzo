import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CAPTION_STYLE } from '../../../shared/caption-style.ts';
import { DEFAULT_CAPTION_Y, newCaptionLayer, SPLIT_CAPTION_Y } from '../../../shared/captions.ts';
import { defaultVideoLayer } from '../../../shared/framing.ts';
import { captionLayerOf, newProject, type Project } from '../../../shared/project.ts';
import { addCaptionKey, deleteCaptionKey, moveCaptions, setCaptionKeySmooth } from './captions.ts';
import { projectStore } from './store.ts';

const CLIP = '0b6f2a52-9d0c-4f39-8f39-7f0e2c9b1a11';

function project(): Project {
  return {
    ...newProject('Titlovi'),
    source: {
      path: 'D:\\Video\\epizoda.mp4',
      size: 1,
      fingerprint: 'a'.repeat(64),
      duration: 600,
      video: { codec: 'h264', width: 1920, height: 1080, frameRate: [30, 1], variableFrameRate: false, colorSpace: null },
      audio: null,
    },
    clips: [{ id: CLIP, name: 'x', start: 10, end: 20, skips: [], evenLoudness: false, layers: [defaultVideoLayer(10), newCaptionLayer(10, DEFAULT_CAPTION_STYLE)] }],
  };
}

const captions = () => captionLayerOf(projectStore.getState().project!.clips[0]!)!;
const values = (keys: { value: number }[]) => keys.map((k) => k.value);

beforeEach(() => projectStore.getState().load(project(), null));

describe('caption position edits', () => {
  it('moves the captions in Split without touching the other layouts', () => {
    moveCaptions(CLIP, 'splitY', 12, 0.55);
    expect(values(captions().splitY)).toEqual([0.55]);
    expect(values(captions().y)).toEqual([DEFAULT_CAPTION_Y]);
  });

  it('moves the captions outside Split without touching Split', () => {
    moveCaptions(CLIP, 'y', 12, 0.8);
    expect(values(captions().y)).toEqual([0.8]);
    expect(values(captions().splitY)).toEqual([SPLIT_CAPTION_Y]);
  });

  it('adds a keyframe at the place shown, on the track in use only', () => {
    addCaptionKey(CLIP, 'splitY', 12);
    expect(values(captions().splitY)).toEqual([SPLIT_CAPTION_Y, SPLIT_CAPTION_Y]);
    expect(values(captions().y)).toEqual([DEFAULT_CAPTION_Y]);
  });

  it('changes and deletes keyframes on the track in use only', () => {
    addCaptionKey(CLIP, 'y', 12);
    addCaptionKey(CLIP, 'splitY', 12);
    setCaptionKeySmooth(CLIP, 'splitY', 0, true);
    expect(captions().splitY[0]!.ease).toBe('smooth');
    expect(captions().y[0]!.ease).toBe('cut');

    deleteCaptionKey(CLIP, 'splitY', 1);
    expect(captions().splitY).toHaveLength(1);
    expect(captions().y).toHaveLength(2);
  });
});
