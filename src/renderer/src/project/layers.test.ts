import { beforeEach, describe, expect, it } from 'vitest';
import type { AssetFile, VideoInfo } from '../../../shared/assets.ts';
import { lottieInfoSchema } from '../../../shared/lottie.ts';
import { defaultVideoLayer } from '../../../shared/framing.ts';
import { newProject, projectSchema, type ImageLayer, type Project, type SoundLayer, type TextLayer } from '../../../shared/project.ts';
import { DEFAULT_TEXT_STYLE } from '../../../shared/text-style.ts';
import {
  addImageLayer, addLibrarySound, addTextLayer, setText, setTextStyle, addLottieLayer, addSoundFile, addVideoLayer, deleteLayer, replaceImage, replaceLottie, replaceSoundFile, replaceVideo, duplicateLayer, moveLayer, reorderLayer, setClipEvenLoudness, setFollowShift, setFollowSound,
  setFollowSoundAsset, setFollowSoundFile, setMotion, setSoundDuck, setSoundSettings, setTransform, trimLayer, unlinkSound,
} from './layers.ts';
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
    clips: [{ id: CLIP, name: 'x', start: 10, end: 20, skips: [], evenLoudness: false, layers: [defaultVideoLayer(10)] }],
  };
}

const state = () => projectStore.getState();
const clip = () => state().project!.clips[0]!;
const images = () => clip().layers.filter((l): l is ImageLayer => l.kind === 'image');

beforeEach(() => state().load(project(), null));

describe("changing a layer's file", () => {
  const MOVED: AssetFile = { ...FILE, path: 'E:\\Novo\\logo-2.png', name: 'logo-2.png' };

  it('uses the same file from where it is now', () => {
    const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
    replaceImage(CLIP, id, MOVED, SIZE);
    expect(state().project!.assets).toHaveLength(1);
    expect(state().project!.assets[0]).toMatchObject({ path: MOVED.path, name: MOVED.name });
    expect(images()[0]!.assetId).toBe(state().project!.assets[0]!.id);
  });

  it('keeps the new place when the change is undone', () => {
    const other: AssetFile = { ...FILE, path: 'D:\\Slike\\drugi.png', name: 'drugi.png', fingerprint: '9'.repeat(64) };
    addImageLayer(CLIP, other, SIZE, 10);
    const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
    // The second layer now shows the first one's file, picked where it has moved to.
    replaceImage(CLIP, id, { ...other, path: MOVED.path, name: MOVED.name }, SIZE);
    state().undo();
    expect(state().project!.assets.find((a) => a.fingerprint === other.fingerprint)).toMatchObject({ path: MOVED.path });
    expect(images().find((l) => l.id === id)!.assetId).toBe(state().project!.assets.find((a) => a.fingerprint === FILE.fingerprint)!.id);
  });

  it('does the same for videos, animations and sounds', () => {
    const video: VideoInfo = { codec: 'h264', width: 640, height: 360, duration: 4, frameRate: [30, 1], colorSpace: null, alpha: false, hasAudio: false };
    const lottie = lottieInfoSchema.parse({ width: 200, height: 200, frames: 60, frameRate: 30 });
    const audio = { codec: 'mp3', duration: 2 };
    const videoId = addVideoLayer(CLIP, { ...FILE, fingerprint: 'd'.repeat(64) }, video, 10) as string;
    const lottieId = addLottieLayer(CLIP, { ...FILE, fingerprint: 'e'.repeat(64) }, lottie, 10)!;
    const soundId = addSoundFile(CLIP, { ...FILE, fingerprint: 'f'.repeat(64) }, audio, 10)!;
    replaceVideo(CLIP, videoId, { ...MOVED, fingerprint: 'd'.repeat(64) }, video);
    replaceLottie(CLIP, lottieId, { ...MOVED, fingerprint: 'e'.repeat(64) }, lottie);
    replaceSoundFile(CLIP, soundId, { ...MOVED, fingerprint: 'f'.repeat(64) }, audio);
    expect(state().project!.assets.map((a) => a.path)).toEqual([MOVED.path, MOVED.path, MOVED.path]);
  });
});

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
      d.clips[0]!.layers.push({ id: crypto.randomUUID(), kind: 'caption', style: undefined as never, y: [{ t: 10, value: 0.7, ease: 'cut' }], splitY: [{ t: 10, value: 0.5, ease: 'cut' }] });
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

  it('keeps keyframes in order when moving pushes some of them before 0', () => {
    const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
    state().edit('history.addKeyframe', (d) => {
      const l = d.clips[0]!.layers[1] as ImageLayer;
      const value = l.transform[0]!.value;
      // Left before the layer by an earlier trim.
      l.transform = [0.5, 1, 12].map((t) => ({ t, value: { ...value, x: t / 20 }, ease: 'cut' as const }));
    });
    moveLayer(CLIP, id, 10);
    expect(images()[0]!.transform.map((k) => k.t)).toEqual([0, 10]);
    expect(images()[0]!.transform[0]!.value.x).toBeCloseTo(1 / 20);
    expect(() => projectSchema.parse(state().project)).not.toThrow();
  });

  it('puts placement edits inside the layer when the playhead is outside it', () => {
    const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
    state().edit('history.addKeyframe', (d) => {
      const l = d.clips[0]!.layers[1] as ImageLayer;
      l.transform.push({ t: 14, value: l.transform[0]!.value, ease: 'cut' });
    });
    setTransform(CLIP, id, 18, { x: 0.9 });
    expect(images()[0]!.transform.map((k) => k.t)).toEqual([12, 14, 15 - 1 / 30]);
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

  it('restacks past sounds, which have no place in the order', () => {
    const a = addImageLayer(CLIP, FILE, SIZE, 10)!;
    const sound = addLibrarySound(CLIP, 'ding', 11)!;
    const b = addImageLayer(CLIP, { ...FILE, fingerprint: 'd'.repeat(64) }, SIZE, 10)!;
    expect(clip().layers.map((l) => l.id).slice(1)).toEqual([a, sound, b]);
    reorderLayer(CLIP, b, 'down');
    expect(clip().layers.map((l) => l.id).slice(1)).toEqual([b, sound, a]);
    reorderLayer(CLIP, sound, 'down');
    expect(clip().layers.map((l) => l.id).slice(1)).toEqual([b, sound, a]);
  });

  it('adds a sound from the library as long as it is, and drops a sound file with its last layer', () => {
    const id = addLibrarySound(CLIP, 'ding', 12)!;
    expect(clip().layers.at(-1)).toMatchObject({ id, kind: 'sound', sound: { library: 'ding' }, start: 12, volume: 1, loop: false });
    const file = addSoundFile(CLIP, { ...FILE, name: 'tema.mp3', fingerprint: 'e'.repeat(64) }, { codec: 'mp3', duration: 4 }, 11)!;
    expect(state().project!.assets).toMatchObject([{ kind: 'audio', name: 'tema.mp3', duration: 4 }]);
    expect(() => projectSchema.parse(state().project)).not.toThrow();
    deleteLayer(CLIP, file);
    expect(state().project!.assets).toEqual([]);
  });

  it('evens out a sound file of your own from the start, not one from the library', () => {
    const library = addLibrarySound(CLIP, 'ding', 12)!;
    const file = addSoundFile(CLIP, { ...FILE, name: 'tema.mp3', fingerprint: 'e'.repeat(64) }, { codec: 'mp3', duration: 4 }, 11)!;
    const layer = (id: string) => clip().layers.find((l) => l.id === id);
    expect(layer(library)).toMatchObject({ evenLoudness: false });
    expect(layer(file)).toMatchObject({ evenLoudness: true });
    setSoundSettings(CLIP, file, { evenLoudness: false });
    expect(layer(file)).toMatchObject({ evenLoudness: false });
    expect(state().undoLabel).toBe('history.soundSettings');
  });

  it('turns music of your own down while someone talks from the start, not a short sound or one from the library', () => {
    const library = addLibrarySound(CLIP, 'applause', 12)!;
    const short = addSoundFile(CLIP, { ...FILE, name: 'udarac.wav', fingerprint: 'e'.repeat(64) }, { codec: 'pcm_s16le', duration: 2 }, 11)!;
    const music = addSoundFile(CLIP, { ...FILE, name: 'tema.mp3', fingerprint: 'd'.repeat(64) }, { codec: 'mp3', duration: 95 }, 10)!;
    const layer = (id: string) => clip().layers.find((l) => l.id === id);
    expect(layer(library)).toMatchObject({ duck: { on: false, db: 12 } });
    expect(layer(short)).toMatchObject({ duck: { on: false } });
    expect(layer(music)).toMatchObject({ duck: { on: true, db: 12 } });
    setSoundDuck(CLIP, short, { on: true, db: 30 });
    expect(layer(short)).toMatchObject({ duck: { on: true, db: 24 } });
    setSoundDuck(CLIP, short, { db: 7.6 });
    expect(layer(short)).toMatchObject({ duck: { db: 8 } });
    expect(state().undoLabel).toBe('history.duck');
  });

  it("switches evening out the clip's own sound, one undo step", () => {
    setClipEvenLoudness(CLIP, true);
    expect(clip().evenLoudness).toBe(true);
    expect(state().undoLabel).toBe('history.evenLoudness');
    state().undo();
    expect(clip().evenLoudness).toBe(false);
  });

  describe('sounds with an entrance or exit', () => {
    const sounds = () => clip().layers.filter((l): l is SoundLayer => l.kind === 'sound');
    const OWN: AssetFile = { ...FILE, name: 'udarac.wav', fingerprint: 'f'.repeat(64) };

    it('adds one where the layer comes in, and moves it with the layer', () => {
      const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
      const sound = setFollowSound(CLIP, id, 'in', 'pop')!;
      expect(sounds()).toMatchObject([{ id: sound, sound: { library: 'pop' }, start: 12, follows: { layerId: id, part: 'in', shift: 0 } }]);
      expect(state().undoLabel).toBe('history.followSound');
      moveLayer(CLIP, id, 13);
      expect(sounds()[0]!.start).toBe(13);
      trimLayer(CLIP, id, 'start', 13.5);
      expect(sounds()[0]!.start).toBe(13.5);
      expect(() => projectSchema.parse(state().project)).not.toThrow();
    });

    it('starts one for the exit where the layer starts going out, and follows a new exit length', () => {
      const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
      setMotion(CLIP, id, 'out', { kind: 'slide', seconds: 0.5 });
      setFollowSound(CLIP, id, 'out', 'whoosh');
      expect(sounds()[0]!.start).toBe(14.5);
      setMotion(CLIP, id, 'out', { seconds: 1 });
      expect(sounds()[0]!.start).toBe(14);
    });

    it("keeps a dragged sound with its layer, and moves it by its shift", () => {
      const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
      const sound = setFollowSound(CLIP, id, 'in', 'pop')!;
      moveLayer(CLIP, sound, 16);
      expect(sounds()[0]!.start).toBe(12);
      setFollowShift(CLIP, sound, -0.2);
      expect(sounds()[0]).toMatchObject({ start: 11.8, follows: { shift: -0.2 } });
      setFollowShift(CLIP, sound, 3);
      expect(sounds()[0]!.follows!.shift).toBe(0.5);
    });

    it('swaps the sound for another one in its place, or takes it away', () => {
      const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
      const sound = setFollowSound(CLIP, id, 'in', 'pop')!;
      setSoundSettings(CLIP, sound, { volume: 0.4 });
      expect(setFollowSound(CLIP, id, 'in', 'ding')).toBe(sound);
      expect(sounds()).toMatchObject([{ id: sound, sound: { library: 'ding' }, volume: 0.4 }]);
      setFollowSound(CLIP, id, 'in', null);
      expect(sounds()).toEqual([]);
    });

    it('plays a file of your own, evened out, and drops it when the sound goes', () => {
      const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
      setFollowSoundFile(CLIP, id, 'out', OWN, { codec: 'pcm_s16le', duration: 0.6 });
      const asset = state().project!.assets.find((a) => a.kind === 'audio')!;
      expect(sounds()[0]).toMatchObject({ sound: { assetId: asset.id }, evenLoudness: true, start: 15 });
      // Picking the same file for the entrance uses it again.
      setFollowSoundAsset(CLIP, id, 'in', asset.id);
      expect(state().project!.assets.filter((a) => a.kind === 'audio')).toHaveLength(1);
      setFollowSound(CLIP, id, 'in', 'pop');
      setFollowSound(CLIP, id, 'out', null);
      expect(state().project!.assets.filter((a) => a.kind === 'audio')).toEqual([]);
    });

    it('deletes its sounds with the layer, in one undo step', () => {
      const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
      setFollowSoundFile(CLIP, id, 'in', OWN, { codec: 'pcm_s16le', duration: 0.6 });
      setFollowSound(CLIP, id, 'out', 'whoosh');
      deleteLayer(CLIP, id);
      expect(clip().layers).toHaveLength(1);
      expect(state().project!.assets).toEqual([]);
      state().undo();
      expect(sounds()).toHaveLength(2);
      expect(state().project!.assets).toHaveLength(2);
    });

    it('copies its sounds with the layer, and a copied sound stands on its own', () => {
      const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
      const sound = setFollowSound(CLIP, id, 'in', 'pop')!;
      const copy = duplicateLayer(CLIP, id);
      expect(sounds().map((s) => s.follows?.layerId)).toEqual([id, copy]);
      moveLayer(CLIP, copy, 15);
      expect(sounds().map((s) => s.start)).toEqual([12, 15]);
      duplicateLayer(CLIP, sound);
      expect(sounds()).toHaveLength(3);
      expect(sounds().filter((s) => s.follows === null)).toHaveLength(1);
      expect(() => projectSchema.parse(state().project)).not.toThrow();
    });

    it('lets a sound stand on its own where it is', () => {
      const id = addImageLayer(CLIP, FILE, SIZE, 12)!;
      const sound = setFollowSound(CLIP, id, 'in', 'pop')!;
      unlinkSound(CLIP, sound);
      moveLayer(CLIP, id, 15);
      expect(sounds()[0]).toMatchObject({ start: 12, follows: null });
      expect(state().undoLabel).toBe('history.moveLayer');
    });
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

describe('text layers', () => {
  const texts = () => clip().layers.filter((l): l is TextLayer => l.kind === 'text');

  it('adds text at the playhead, high up, under the captions, with no file', () => {
    const id = addTextLayer(CLIP, 'Šta se *desilo*?', 12)!;
    expect(texts()).toEqual([expect.objectContaining({ id, text: 'Šta se *desilo*?', style: DEFAULT_TEXT_STYLE, start: 12, end: 15 })]);
    expect(texts()[0]!.transform[0]!.value).toMatchObject({ x: 0.5, scale: 1 });
    expect(state().project!.assets).toEqual([]);
    expect(projectSchema.safeParse(state().project).success).toBe(true);
  });

  it('changes the text and the look, each an undo step', () => {
    const id = addTextLayer(CLIP, 'prvo', 12)!;
    setText(CLIP, id, 'drugo');
    setTextStyle(CLIP, id, { color: '#ff0000', band: { color: '#000000' } });
    expect(texts()[0]).toMatchObject({ text: 'drugo', style: { color: '#ff0000', band: { color: '#000000' }, accent: DEFAULT_TEXT_STYLE.accent } });
    state().undo();
    expect(texts()[0]).toMatchObject({ text: 'drugo', style: DEFAULT_TEXT_STYLE });
    state().undo();
    expect(texts()[0]!.text).toBe('prvo');
  });

  it('moves, places, duplicates and deletes like an image', () => {
    const id = addTextLayer(CLIP, 'naslov', 12)!;
    moveLayer(CLIP, id, 14);
    setTransform(CLIP, id, 15, { y: 0.8 });
    const copy = duplicateLayer(CLIP, id);
    expect(texts().map((l) => l.id)).toEqual([id, copy]);
    expect(texts()[1]).toMatchObject({ text: 'naslov', start: 14, end: 17 });
    expect(texts()[1]!.transform[0]!.value.y).toBe(0.8);
    deleteLayer(CLIP, id);
    expect(texts().map((l) => l.id)).toEqual([copy]);
  });

  it('can have a sound with its entrance', () => {
    const id = addTextLayer(CLIP, 'naslov', 12)!;
    const sound = setFollowSound(CLIP, id, 'in', 'whoosh');
    expect(clip().layers.find((l) => l.id === sound)).toMatchObject({ kind: 'sound', follows: { layerId: id, part: 'in' } });
    expect(projectSchema.safeParse(state().project).success).toBe(true);
  });
});
