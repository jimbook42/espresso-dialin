/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShotReplayRecorder, SHOT_REPLAY_MAX_DURATION_S } from './shotReplayRecorder.js';

class TestMediaRecorder {
  static isTypeSupported() { return true; }

  state = 'inactive';

  start() { this.state = 'recording'; }

  stop() {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['video']) });
      this.onstop?.();
    });
  }
}

const stream = { getVideoTracks: () => [{}] };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MediaRecorder', TestMediaRecorder);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shot replay recording', () => {
  it('keeps the capped recording when the shot ends after the limit', async () => {
    const replay = createShotReplayRecorder();
    expect(replay.start(stream, 720, 1280)).toBe(true);
    await vi.advanceTimersByTimeAsync((SHOT_REPLAY_MAX_DURATION_S + 5) * 1000);

    const result = await replay.stop();
    expect(result).toMatchObject({ durationS: SHOT_REPLAY_MAX_DURATION_S, videoW: 720, videoH: 1280 });
    expect(result.blob.size).toBe(5);
    expect(await replay.stop()).toBeNull();
  });

  it('keeps an older stop separate from a recording started before it finishes', async () => {
    const replay = createShotReplayRecorder();
    replay.start(stream, 720, 1280);
    await vi.advanceTimersByTimeAsync(1000);
    const first = replay.stop();
    replay.start(stream, 540, 960);
    await vi.advanceTimersByTimeAsync(2000);
    const second = replay.stop();

    expect(await first).toMatchObject({ durationS: 1, videoW: 720, videoH: 1280 });
    expect(await second).toMatchObject({ durationS: 2, videoW: 540, videoH: 960 });
  });
});
