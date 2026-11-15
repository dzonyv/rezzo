import { beforeEach, describe, expect, it } from 'vitest';
import type { AssetFile } from '../../../shared/assets.ts';
import { defaultVideoLayer } from '../../../shared/framing.ts';
import { newProject, projectSchema, videoLayerOf, type Project } from '../../../shared/project.ts';
import { addCoverImage, addCoverText, followClipFraming, setCoverTime } from './cover.ts';
import { setFraming, setLayout } from './framing.ts';
import { addImageLayer, deleteLayer, duplicateLayer, reorderLayer, setText, setTransform } from './layers.ts';
import { projectStore } from './store.ts';

const CLIP = '0b6f2a52-9d0c-4f39-8f39-7f0e2c9b1a11';
const FILE: AssetFile = { path: 'D:\\Slike\\logo.png', name: 'logo.png', size: 2048, fingerprint: 'c'.repeat(64) };
const SIZE = { width: 400, height: 200 };

function project(): Project {
  return {
    ...newProject('Naslovna'),
    source: {
      path: 'D:\\Video\\epizoda.mp4',
      size: 1,
      fingerprint: 'a'.repeat(64),
      duration: 600,
      video: { codec: 'h264', width: 1920, height: 1080, frameRate: [30, 1], variableFrameRate: false, colorSpace: null },
      audio: null,
    },
    clips: [{ id: CLIP, name: 'x', start: 10, end: 20, skips: [{ start: 12, end: 13 }], evenLoudness: false, layers: [defaultVideoLayer(10)] }],
  };
}

const state = () => projectStore.getState();
const clip = () => state().project!.clips[0]!;
const cover = () => clip().cover!;
const valid = () => expect(() => projectSchema.parse(state().project)).not.toThrow();

beforeEach(() => state().load(project(), null));

describe('cover edits', () => {
  it('makes the cover with its first edit: the first frame, the clip framing, the new text', () => {
    expect(clip().cover).toBeUndefined();
    const id = addCoverText(CLIP, 'Naslov');
    expect(cover()).toMatchObject({ time: 10, video: null, layers: [{ id, kind: 'text', text: 'Naslov', transform: [{ t: 10 }] }] });
    expect(clip().layers).toHaveLength(1);
    valid();
    state().undo();
    expect(clip().cover).toBeUndefined();
  });

  it("edits a cover layer with the clip's layer edits, one key whatever the time", () => {
    const id = addCoverText(CLIP, 'Naslov');
    setTransform(CLIP, id, 17, { y: 0.7 });
    setText(CLIP, id, 'Drugi naslov');
    expect(cover().layers[0]).toMatchObject({ text: 'Drugi naslov', transform: [{ t: 10, value: { y: 0.7 } }] });
    const copy = duplicateLayer(CLIP, id);
    expect(cover().layers.map((l) => l.id)).toEqual([id, copy]);
    reorderLayer(CLIP, copy, 'down');
    expect(cover().layers.map((l) => l.id)).toEqual([copy, id]);
    deleteLayer(CLIP, copy);
    expect(cover().layers.map((l) => l.id)).toEqual([id]);
    valid();
  });

  it("keeps an image's file while the cover shows it, and drops it with the last layer", () => {
    const onClip = addImageLayer(CLIP, FILE, SIZE, 10)!;
    const onCover = addCoverImage(CLIP, FILE, SIZE);
    expect(state().project!.assets).toHaveLength(1);
    deleteLayer(CLIP, onClip);
    expect(state().project!.assets).toHaveLength(1);
    valid();
    deleteLayer(CLIP, onCover);
    expect(state().project!.assets).toEqual([]);
  });

  it('moves to a frame the clip plays', () => {
    setCoverTime(CLIP, 11.01);
    expect(cover().time).toBe(11);
    setCoverTime(CLIP, 12.5);
    expect(cover().time).toBe(13);
    state().undo();
    expect(cover().time).toBe(11);
  });

  it("frames the cover on its own, one key a track, leaving the clip's framing as it was", () => {
    const before = videoLayerOf(clip());
    setCoverTime(CLIP, 15);
    setLayout(CLIP, 15, 'split', 'cover');
    setFraming(CLIP, 'history.moveFrame', 'splitTop', 15, { x: 0.3, y: 0.5, zoom: 1.5 }, 'cover');
    setFraming(CLIP, 'history.moveFrame', 'splitTop', 11, { x: 0.35, y: 0.5, zoom: 1.5 }, 'cover');
    expect(videoLayerOf(clip())).toEqual(before);
    const own = cover().video!;
    expect(own.layout).toEqual([{ t: 15, value: 'split', ease: 'cut' }]);
    expect(own.splitTop).toEqual([{ t: 15, value: { x: 0.35, y: 0.5, zoom: 1.5 }, ease: 'cut' }]);
    expect(own.id).not.toBe(before.id);
    valid();
    followClipFraming(CLIP);
    expect(cover().video).toBeNull();
  });
});
