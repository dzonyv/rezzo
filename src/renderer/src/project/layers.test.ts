import { beforeEach, describe, expect, it } from 'vitest';
import type { AssetFile } from '../../../shared/assets.ts';
import { defaultVideoLayer } from '../../../shared/framing.ts';
import { newProject, projectSchema, type ImageLayer, type Project } from '../../../shared/project.ts';
import { addImageLayer, deleteLayer, duplicateLayer, moveLayer, reorderLayer, setTransform, trimLayer } from './layers.ts';
import { projectStore } from './store.ts';

const CLIP = '0b6f2a52-9d0c-4f39-8f39-7f0e2c9b1a11';
const FILE: AssetFile = { path: 'D:\\Slike\\logo.png', name: 'logo.png', size: 2048, fingerprint: 'c'.repeat(64) };
const SIZE = { width: 400, height: 200 };

function project(): Project {
  return {
    ...newProject('Slojevi'),
    source: {
      path: 'D:\\Video\\epizoda.mp4',
      size: 1,
      fingerprint: 'a'.repeat(64),
      duration: 600,
      video: { codec: 'h264', width: 1920, height: 1080, frameRate: [30, 1], variableFrameRate: false, colorSpace: null },
      audio: null,
    },
    clips: [{ id: CLIP, name: 'x', start: 10, end: 20, layers: [defaultVideoLayer(10)] }],
  };
}

const state = () => projectStore.getState();
const clip = () => state().project!.clips[0]!;
const images = () => clip().layers.filter((l): l is ImageLayer => l.kind === 'image');

beforeEach(() => state().load(project(), null));

describe('layer edits', () => {
  it('adds an image from the playhead on, for three seconds, with its file', () => {
    const id = addImageLayer(CLIP, FILE, SIZE, 12.01)!;
    expect(images()).toHaveLength(1);
    expect(images()[0]).toMatchObject({ id, start: 12, end: 15 });
    expect(state().project!.assets).toMatchObject([{ kind: 'image', name: 'logo.png', width: 400, height: 200 }]);
    expect(() => projectSchema.parse(state().project)).not.toThrow();
  });

  it('fits a new image in the clip when added near its end', () => {
    addImageLayer(CLIP, FILE, SIZE, 19.5);
    expect(images()[0]).toMatchObject({ start: 17, end: 20 });
  });

  it('keeps one file for two images of it', () => {
    addImageLayer(CLIP, FILE, SIZE, 10);
    addImageLayer(CLIP, FILE, SIZE, 14);
    expect(state().project!.assets).toHaveLength(1);
  });

  it('puts new images under the captions', () => {
    state().edit('history.addCaptions', (d) => {
      d.clips[0]!.layers.push({ id: crypto.randomUUID(), kind: 'caption', style: undefined as never, y: [{ t: 10, value: 0.7, ease: 'cut' }] });
    });
    addImageLayer(CLIP, FILE, SIZE, 10);
    expect(clip().layers.map((l) => l.kind)).toEqual(['video', 'image', 'caption']);
  });

  it('moves an image in time with its keyframes, inside the clip', () => {
    const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
    setTransform(CLIP, id, 12, { x: 0.3 });
    state().edit('history.addKeyframe', (d) => {
      const l = d.clips[0]!.layers[1] as ImageLayer;
      l.transform.push({ t: 14, value: { ...l.transform[0]!.value, x: 0.7 }, ease: 'cut' });
    });
    moveLayer(CLIP, id, 13);
    expect(images()[0]).toMatchObject({ start: 13, end: 16 });
    expect(images()[0]!.transform.map((k) => k.t)).toEqual([13, 15]);
    moveLayer(CLIP, id, 30);
    expect(images()[0]).toMatchObject({ start: 17, end: 20 });
  });

  it('trims an image, keeping it a frame long at least', () => {
    const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
    trimLayer(CLIP, id, 'end', 11);
    expect(images()[0]!.end).toBeCloseTo(12 + 1 / 30);
    trimLayer(CLIP, id, 'start', 5);
    expect(images()[0]!.start).toBe(10);
  });

  it('keeps placement inside what a project file allows', () => {
    const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
    setTransform(CLIP, id, 12, { x: 7, scale: 50, opacity: 2 });
    expect(images()[0]!.transform[0]!.value).toMatchObject({ x: 2, scale: 8, opacity: 1 });
    expect(() => projectSchema.parse(state().project)).not.toThrow();
  });

  it('restacks layers but leaves the video at the bottom', () => {
    const a = addImageLayer(CLIP, FILE, SIZE, 10)!;
    const b = addImageLayer(CLIP, { ...FILE, fingerprint: 'd'.repeat(64) }, SIZE, 10)!;
    reorderLayer(CLIP, b, 'down');
    expect(clip().layers.map((l) => l.id).slice(1)).toEqual([b, a]);
    reorderLayer(CLIP, b, 'down');
    expect(clip().layers[0]!.kind).toBe('video');
  });

  it('drops the file with its last image, and undo brings both back', () => {
    const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
    const copy = duplicateLayer(CLIP, id);
    deleteLayer(CLIP, id);
    expect(state().project!.assets).toHaveLength(1);
    deleteLayer(CLIP, copy);
    expect(state().project!.assets).toHaveLength(0);
    expect(state().undoLabel).toBe('history.deleteLayer');
    state().undo();
    expect(images()).toHaveLength(1);
    expect(state().project!.assets).toHaveLength(1);
  });
});
