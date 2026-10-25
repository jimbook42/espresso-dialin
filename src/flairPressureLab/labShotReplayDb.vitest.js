import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import {
  deleteLastLabShotReplay,
  loadLastLabShotReplayMeta,
  saveLastLabShotReplay,
} from './labShotReplayDb.js';

describe('labShotReplayDb replace-last', () => {
  beforeEach(async () => {
    await deleteLastLabShotReplay();
  });

  it('stores only the latest replay record', async () => {
    const blob = new Blob(['a'], { type: 'video/webm' });
    await saveLastLabShotReplay({
      shotId: 'shot-a',
      blob,
      mimeType: 'video/webm',
      videoW: 640,
      videoH: 480,
      durationS: 12,
      samples: [{ tS: 0, bar: 2, valid: true, hubX: 1, hubY: 2, radius: 30, needleDeg: 10 }],
    });
    let meta = await loadLastLabShotReplayMeta();
    expect(meta?.shotId).toBe('shot-a');

    const blob2 = new Blob(['bb'], { type: 'video/webm' });
    await saveLastLabShotReplay({
      shotId: 'shot-b',
      blob: blob2,
      mimeType: 'video/webm',
      videoW: 1280,
      videoH: 720,
      durationS: 20,
      samples: [{ tS: 0, bar: 4, valid: true, hubX: 3, hubY: 4, radius: 50, needleDeg: 20 }],
    });
    meta = await loadLastLabShotReplayMeta();
    expect(meta?.shotId).toBe('shot-b');
    expect(meta?.byteSize).toBe(blob2.size);
  });
});
