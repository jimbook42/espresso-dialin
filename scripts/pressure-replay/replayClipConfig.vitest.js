import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  REPLAY_CLIP_ROTATION_DEG,
  ffmpegTransposeFilter,
  storedRotationDeg,
} from './replayClipConfig.js';

describe('replayClipConfig', () => {
  it('lists the two R5 clips with distinct rotations', () => {
    expect(REPLAY_CLIP_ROTATION_DEG['20261024_124006']).toBe(-90);
    expect(REPLAY_CLIP_ROTATION_DEG['20261024_124140']).toBe(90);
    expect(storedRotationDeg('20261024_124006')).toBe(-90);
    expect(storedRotationDeg('20261017_084814', 0)).toBe(0);
    expect(storedRotationDeg('unknown', 180)).toBe(180);
  });

  it('maps quarter turns to ffmpeg transpose filters', () => {
    expect(ffmpegTransposeFilter(90)).toBe('transpose=1');
    expect(ffmpegTransposeFilter(-90)).toBe('transpose=2');
    expect(ffmpegTransposeFilter(180)).toBe('transpose=2,transpose=2');
    expect(ffmpegTransposeFilter(0)).toBeNull();
  });
});

describe('HEVC transcode path', () => {
  it('transcodes a tiny synthetic HEVC clip to H.264 1280x720', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hevc-r5-'));
    const src = path.join(dir, 'src.mp4');
    const dest = path.join(dir, 'out.mp4');
    const gen = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=0.2',
      '-c:v', 'libx265', '-tag:v', 'hvc1', src,
    ], { encoding: 'utf8' });
    expect(gen.status).toBe(0);
    const xcode = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-noautorotate',
      '-i', src,
      '-vf', 'scale=1280:720:flags=bicubic',
      '-r', '30', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-an',
      dest,
    ], { encoding: 'utf8' });
    expect(xcode.status).toBe(0);
    expect(fs.statSync(dest).size).toBeGreaterThan(1000);
    const probe = spawnSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height',
      '-of', 'json', dest,
    ], { encoding: 'utf8' });
    expect(probe.status).toBe(0);
    const stream = JSON.parse(probe.stdout).streams[0];
    expect(stream.codec_name).toBe('h264');
    expect(stream.width).toBe(1280);
    expect(stream.height).toBe(720);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
