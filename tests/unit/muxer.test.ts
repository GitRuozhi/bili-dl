import { describe, it, expect, vi, beforeEach } from 'vitest';
import MP4Box from 'mp4box';
import { muxMp4 } from '../../src/media/muxer';
vi.mock('mp4box', () => ({ default: { createFile: vi.fn() } }));

describe('MP4 muxer failure handling', () => {
  beforeEach(() => vi.clearAllMocks());
  function setup(failure: 'callback' | 'throw' | 'empty' | 'track') {
    const output = {
      addTrack: vi.fn(() => failure === 'track' ? undefined : 1),
      getTrackById: vi.fn(), addSample: vi.fn(), flush: vi.fn(),
      getBuffer: vi.fn(() => new ArrayBuffer(0)),
    };
    const input = {
      onReady: undefined as ((info: unknown) => void) | undefined,
      onError: undefined as ((error: string) => void) | undefined,
      onSamples: undefined as ((id: number, ref: unknown, samples: unknown[]) => void) | undefined,
      getTrackById: () => ({ samples: [{}] }),
      setExtractionOptions: vi.fn(), start: vi.fn(), flush: vi.fn(),
      appendBuffer() {
        if (failure === 'throw') throw new Error('parser threw');
        this.onReady?.({ videoTracks: [{ id: 1, codec: 'avc1', timescale: 25, duration: 1, nb_samples: 1 }] });
        this.onSamples?.(1, null, [{ data: new Uint8Array([1]), duration: 1, dts: 0, cts: 0, is_sync: true }]);
        if (failure === 'callback') this.onError?.('parser callback failed');
      },
    };
    vi.mocked(MP4Box.createFile).mockReturnValueOnce(output as never).mockReturnValueOnce(input as never);
    return output;
  }
  it.each(['callback', 'throw', 'empty', 'track'] as const)('rejects %s failures without fallback', async (failure) => {
    const output = setup(failure);
    const progress = vi.fn();
    await expect(muxMp4(new ArrayBuffer(8), undefined, progress)).rejects.toThrow();
    expect(progress).not.toHaveBeenCalledWith(100);
    if (failure !== 'empty') expect(output.getBuffer).not.toHaveBeenCalled();
  });
});
