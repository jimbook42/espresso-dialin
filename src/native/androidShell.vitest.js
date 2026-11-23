import { beforeEach, expect, it, vi } from 'vitest';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { AndroidShell, saveAndroidFile, saveAndroidReplay } from './androidShell.js';

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => ({
    beginFileExport: vi.fn(), beginReplayExport: vi.fn(), appendFileExport: vi.fn(),
    exportFile: vi.fn(), cancelFileExport: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  AndroidShell.cancelFileExport.mockResolvedValue(undefined);
});

it('stages every byte before invoking the picker and preserves cancellation', async () => {
  const data = new Uint8Array(256 * 1024 + 3).fill(148);
  data[data.length - 1] = 17;
  AndroidShell.exportFile.mockResolvedValue({ cancelled: true });
  await expect(saveAndroidFile(new Blob([data], { type: 'image/png' }), 'shot.png')).resolves.toEqual({ cancelled: true });
  const [{ id }] = AndroidShell.beginFileExport.mock.calls[0];
  expect(AndroidShell.beginFileExport).toHaveBeenCalledWith({ id, filename: 'shot.png', mimeType: 'image/png', byteCount: data.length });
  const chunks = AndroidShell.appendFileExport.mock.calls.map(([chunk]) => chunk);
  expect(chunks.map(({ offset }) => offset)).toEqual([0, 256 * 1024]);
  assert.deepEqual(Buffer.concat(chunks.map(({ data: encoded }) => Buffer.from(encoded, 'base64'))), Buffer.from(data));
  expect(AndroidShell.exportFile).toHaveBeenCalledWith({ id, share: false, feedback: false });
  expect(AndroidShell.exportFile.mock.invocationCallOrder[0]).toBeGreaterThan(AndroidShell.appendFileExport.mock.invocationCallOrder.at(-1));
});

it.each(['image/png', 'application/json', 'text/csv;charset=utf-8'])('requires an exact native byte receipt for %s sharing', async (type) => {
  const data = new Blob(['abc'], { type });
  AndroidShell.exportFile.mockResolvedValueOnce({ bytesWritten: 3 }).mockResolvedValueOnce({ bytesWritten: 0 });
  await expect(saveAndroidFile(data, 'sample', true, { feedback: true })).resolves.toEqual({ bytesWritten: 3 });
  expect(AndroidShell.exportFile.mock.calls[0][0]).toMatchObject({ share: true, feedback: true });
  await expect(saveAndroidFile(data, 'sample', true)).rejects.toThrow(/complete export/);
  expect(AndroidShell.cancelFileExport).toHaveBeenCalledOnce();
});

it('never opens a picker for empty input or failed staging and cleans up failed staging', async () => {
  await expect(saveAndroidFile(new Blob(), 'empty.png')).rejects.toThrow(/contain data/);
  expect(AndroidShell.beginFileExport).not.toHaveBeenCalled();
  AndroidShell.appendFileExport.mockRejectedValue(new Error('Broken transfer'));
  await expect(saveAndroidFile(new Blob(['abc']), 'broken.png')).rejects.toThrow(/Broken transfer/);
  expect(AndroidShell.exportFile).not.toHaveBeenCalled();
  expect(AndroidShell.cancelFileExport).toHaveBeenCalledOnce();
});

it('uses a separate bounded replay path and sends only a chunk at a time', async () => {
  const largeSize = 64 * 1024 * 1024 + 1;
  const size = 256 * 1024 + 1;
  const slice = vi.fn((start, end) => new Blob([new Uint8Array(end - start)]));
  const replay = { size, type: 'video/webm;codecs=vp8', slice };
  await expect(saveAndroidFile({ ...replay, size: largeSize }, 'replay.webm')).rejects.toThrow(/64 MiB/);
  const interrupted = vi.fn(() => { throw new Error('test interruption'); });
  await expect(saveAndroidReplay({ ...replay, size: largeSize, slice: interrupted }, 'replay.webm')).rejects.toThrow(/test interruption/);
  expect(AndroidShell.beginReplayExport.mock.calls[0][0].byteCount).toBe(largeSize);
  expect(interrupted).toHaveBeenCalledWith(0, 256 * 1024);
  AndroidShell.exportFile.mockResolvedValue({ bytesWritten: size, filename: 'replay (1).webm' });
  await expect(saveAndroidReplay(replay, 'replay.webm')).resolves.toMatchObject({ filename: 'replay (1).webm' });
  expect(AndroidShell.beginReplayExport).toHaveBeenCalledWith({
    id: expect.any(String), filename: 'replay.webm', mimeType: 'video/webm', byteCount: size,
  });
  expect(AndroidShell.beginFileExport).not.toHaveBeenCalled();
  expect(slice).toHaveBeenCalledTimes(2);
  expect(slice).toHaveBeenLastCalledWith(size - 1, size);
  expect(AndroidShell.exportFile.mock.calls[0][0]).toMatchObject({ share: false });
});

it('rejects unsupported and oversized replay input before staging', async () => {
  await expect(saveAndroidReplay(new Blob(['no'], { type: 'application/octet-stream' }), 'clip.mp4')).rejects.toThrow(/unsupported/);
  await expect(saveAndroidReplay({ size: 256 * 1024 * 1024 + 1, type: 'video/mp4' }, 'clip.mp4')).rejects.toThrow(/256 MiB/);
  expect(AndroidShell.beginReplayExport).not.toHaveBeenCalled();
});
