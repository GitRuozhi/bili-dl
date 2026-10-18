// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import MP4Box, { type MP4Sample } from 'mp4box';
import { muxMp4 } from '../../src/media/muxer';

function fixture(name: string): ArrayBuffer {
  const data = readFileSync(new URL(`../fixtures/media/${name}.mp4`, import.meta.url));
  return Uint8Array.from(data).buffer;
}
function inspect(buffer: ArrayBuffer) {
  const file = MP4Box.createFile();
  const samples = new Map<number, MP4Sample[]>();
  file.onError = (error) => { throw new Error(error); };
  file.onReady = (info) => {
    for (const track of [...info.videoTracks, ...info.audioTracks]) {
      samples.set(track.id, []);
      file.setExtractionOptions(track.id, null, { nbSamples: 1000 });
    }
    file.start();
  };
  file.onSamples = (id, _ref, batch) => samples.get(id)!.push(...batch);
  file.appendBuffer(Object.assign(buffer, { fileStart: 0 }));
  file.flush();
  return { file, samples };
}

describe('real MP4 remuxing (no MP4Box mock)', () => {
  it.each([true, false])('preserves media samples and timing with audio=%s', async (withAudio) => {
    const progress = vi.fn();
    const result = await muxMp4(fixture('video'), withAudio ? fixture('audio') : undefined, progress);
    expect(result.type).toBe('video/mp4');
    const output = inspect(await result.arrayBuffer());
    expect(output.file.moov?.traks).toHaveLength(withAudio ? 2 : 1);
    for (const [index, name] of (withAudio ? ['video', 'audio'] : ['video']).entries()) {
      const source = inspect(fixture(name));
      const expected = [...source.samples.values()][0]!;
      const actual = output.samples.get(index + 1)!;
      expect(actual.length).toBeGreaterThan(0);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((sample, i) => {
        expect(new Uint8Array(sample.data)).toEqual(new Uint8Array(expected[i]!.data));
        expect(sample.duration).toBe(expected[i]!.duration);
        expect(sample.dts).toBe(expected[i]!.dts - expected[0]!.dts);
        expect(sample.cts - sample.dts).toBe(expected[i]!.cts - expected[i]!.dts);
        expect(sample.is_sync).toBe(expected[i]!.is_sync);
      });
      const track = output.file.moov!.traks![index]!;
      expect(track.mdia?.mdhd?.duration).toBeGreaterThan(0);
      expect(track.tkhd?.duration).toBeGreaterThan(0);
    }
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  const damaged = new Uint8Array([1, 2, 3, 4]).buffer;
  it.each([
    ['damaged video', () => damaged.slice(0), () => fixture('audio')],
    ['damaged audio', () => fixture('video'), () => damaged.slice(0)],
    ['empty video', () => new ArrayBuffer(0), () => fixture('audio')],
    ['empty audio', () => fixture('video'), () => new ArrayBuffer(0)],
    ['missing video track', () => fixture('audio'), () => fixture('audio')],
    ['missing audio track', () => fixture('video'), () => fixture('video')],
    ['truncated video', () => fixture('video').slice(0, -100), () => fixture('audio')],
    ['truncated audio', () => fixture('video'), () => fixture('audio').slice(0, -100)],
  ] as const)('rejects %s without reporting completion', async (_name, video, audio) => {
    const progress = vi.fn();
    await expect(muxMp4(video(), audio(), progress)).rejects.toThrow();
    expect(progress).not.toHaveBeenCalledWith(100);
  });
});
