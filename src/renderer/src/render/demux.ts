/**
 * Splits a working file (an MP4 already in memory) into H.264 samples for
 * VideoDecoder. Taken from the Phase 0 export lab (spikes/export/lab/decode.ts).
 */
import { createFile, DataStream, Endianness, MP4BoxBuffer, type Sample } from 'mp4box';

export interface Demuxed {
  config: VideoDecoderConfig;
  width: number;
  height: number;
  /** In decode order, which is also display order: working files have no B-frames. */
  samples: { data: Uint8Array; timestampUs: number; durationUs: number; isKey: boolean }[];
}

export async function demux(bytes: ArrayBuffer): Promise<Demuxed> {
  const mp4 = createFile();

  return new Promise((resolve, reject) => {
    let config: VideoDecoderConfig | undefined;
    let size = { width: 0, height: 0 };
    const samples: Demuxed['samples'] = [];
    let expected = 0;

    mp4.onError = (_module, message) => reject(new Error(message));
    mp4.onReady = (info) => {
      const track = info.videoTracks[0];
      if (!track?.video) return reject(new Error('the working file has no video track'));
      expected = track.nb_samples;
      size = { width: track.video.width, height: track.video.height };
      config = {
        codec: track.codec,
        codedWidth: track.video.width,
        codedHeight: track.video.height,
        description: avcDescription(mp4.getTrackById(track.id)),
        // Chromium takes "prefer-hardware" as "hardware only" and fails without a
        // decoder on the GPU; with no preference it still uses the GPU when it can.
        hardwareAcceleration: 'no-preference',
        optimizeForLatency: true,
      };
      mp4.setExtractionOptions(track.id, undefined, { nbSamples: Infinity });
      mp4.start();
    };
    mp4.onSamples = (_id, _user, batch: Sample[]) => {
      for (const s of batch) {
        samples.push({
          data: s.data!,
          // Whole microseconds: WebCodecs truncates timestamps, and frames are matched back by them.
          timestampUs: Math.round((s.cts * 1e6) / s.timescale),
          durationUs: Math.round((s.duration * 1e6) / s.timescale),
          isKey: s.is_sync,
        });
      }
      if (samples.length === expected) resolve({ config: config!, ...size, samples });
    };

    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes, 0));
    mp4.flush();
  });
}

/** The avcC box payload (without its 8-byte header) is what VideoDecoder wants as `description`. */
function avcDescription(trak: ReturnType<ReturnType<typeof createFile>['getTrackById']>): Uint8Array {
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = (entry as { avcC?: { write(s: DataStream): void } }).avcC;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  throw new Error('no avcC box');
}
