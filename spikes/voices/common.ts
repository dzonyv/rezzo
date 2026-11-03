import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pcmSamples } from '../faces/labels.ts';
import { mediaDir, modelsDir } from '../shared/paths.ts';
import { whisperDir } from '../whisper/clips.ts';

export const voicesDir = path.join(mediaDir, 'voices');
export const runsDir = path.join(voicesDir, 'runs');
export const voiceModelsDir = path.join(modelsDir, 'voices');
export const segmentationModel = path.join(voiceModelsDir, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.onnx');

/** Speaker embedding models under test, by short name. */
export const EMBEDDINGS: Record<string, string> = {
  'campplus-en': '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx',
  'campplus-zh-en': '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  'eres2net-en': '3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx',
  'we-resnet34': 'wespeaker_en_voxceleb_resnet34_LM.onnx',
  'we-campplus': 'wespeaker_en_voxceleb_CAM%2B%2B_LM.onnx',
  'titanet-s': 'nemo_en_titanet_small.onnx',
};

/**
 * The audio files: whisper's 16 kHz mono WAV of each clip, and all four
 * joined (in the order of `_all-clips.txt`), which stands in for a longer
 * recording with more voices until we have a full episode.
 */
export const JOINED = '_all-clips';
export const audioFile = (id: string) => path.join(whisperDir, 'audio', `${id}.wav`);

/** How many people talk in each audio file, by the maintainer's account. */
export const SPEAKERS: Record<string, number> = { 'clip-a': 1, 'clip-b': 1, 'clip-c': 1, 'clip-d': 2, [JOINED]: 5 };

export async function readSamples(file: string): Promise<Float32Array> {
  const pcm = pcmSamples(await readFile(file));
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

/** The clips that make up the joined file, in order. */
export async function joinedParts(): Promise<string[]> {
  const list = await readFile(path.join(whisperDir, 'audio', `${JOINED}.txt`), 'utf8');
  return [...list.matchAll(/file '.*\/([^/]+)\.wav'/g)].map((m) => m[1]);
}

export interface Segment {
  start: number;
  end: number;
  speaker: number;
}

export interface Run {
  audio: string;
  model: string;
  /** `n<k>` for a given number of speakers, `t<threshold>` otherwise. */
  setting: string;
  threads: number;
  audioSeconds: number;
  wallSeconds: number;
  segments: Segment[];
}

export const runPath = (audio: string, model: string, setting: string) => path.join(runsDir, `${audio}__${model}__${setting}.json`);
