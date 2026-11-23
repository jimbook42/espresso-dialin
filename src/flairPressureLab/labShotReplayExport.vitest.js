import { expect, it, vi } from 'vitest';
import { exportLabShotFiles } from './labShotReplayExport.js';

const shot = { id: 'test-shot', labPressureCurve: [{ tS: 0, bar: 0 }, { tS: 0.5, bar: 4 }] };
const blob = new Blob([Uint8Array.of(0x1a, 0x45, 0xdf, 0xa3, 1)], { type: 'video/webm' });
const replay = { meta: { shotId: shot.id, mimeType: 'video/webm;codecs=vp8' }, blob };

it('saves byte-identical video and a separate JSON with the associated pressure curve', async () => {
  const saveVideo = vi.fn(async (file) => ({ bytesWritten: file.size, filename: 'chosen.webm' }));
  const save = vi.fn(async (file) => ({ bytesWritten: file.size }));
  const result = await exportLabShotFiles({ shot, replay, includeVideo: true }, { native: true, save, saveVideo });
  expect(result.map(({ status }) => status)).toEqual(['saved', 'saved']);
  expect(result[0]).toMatchObject({ savedAs: 'chosen.webm', bytes: blob.size });
  expect(await saveVideo.mock.calls[0][0].arrayBuffer()).toEqual(await blob.arrayBuffer());
  expect(saveVideo.mock.calls[0][0].type).toBe('video/webm');
  expect(JSON.parse(await save.mock.calls[0][0].text())).toMatchObject(shotForExport());
});

it('keeps a verified video receipt if the second picker is cancelled or verification fails', async () => {
  const saveVideo = vi.fn(async (file) => ({ bytesWritten: file.size }));
  const save = vi.fn().mockResolvedValueOnce({ cancelled: true }).mockResolvedValueOnce({ bytesWritten: 1 });
  const request = { shot, replay, includeVideo: true };
  const options = { native: true, saveVideo, save };
  expect((await exportLabShotFiles(request, options)).map(({ status }) => status)).toEqual(['saved', 'cancelled']);
  expect((await exportLabShotFiles(request, options)).map(({ status }) => status)).toEqual(['saved', 'failed']);
});

it('never exports another shot’s replay and preserves ordinary web downloads', async () => {
  const download = vi.fn();
  const options = { native: false, download };
  await expect(exportLabShotFiles({
    shot: { ...shot, id: 'different' }, replay, includeVideo: true,
  }, options)).rejects.toThrow(/unavailable/);
  expect(download).not.toHaveBeenCalled();
  const [result] = await exportLabShotFiles({ shot, replay, includeVideo: false }, options);
  expect(result).toMatchObject({ status: 'download', name: 'lab-replay-test-shot-pressure.json' });
  expect(JSON.parse(await download.mock.calls[0][1].text())).toMatchObject(shotForExport());
});

function shotForExport() {
  return { shotId: shot.id, labPressureCurve: shot.labPressureCurve };
}
