import { describe, expect, it } from 'vitest';
import { bindCameraTrackEvents, createCameraTrackLog, resetCameraTrackLog } from './useFrontCameraStream.js';

describe('camera track diagnostics', () => {
  it('counts mute, unmute and ended and can reset the counts for a new shot', () => {
    const log = createCameraTrackLog();
    const track = new EventTarget();
    track.readyState = 'live';
    track.muted = false;
    const unbind = bindCameraTrackEvents(track, log);
    expect(log.readyState).toBe('live');
    expect(log.muted).toBe(false);
    track.muted = true;
    track.dispatchEvent(new Event('mute'));
    track.muted = false;
    track.dispatchEvent(new Event('unmute'));
    track.readyState = 'ended';
    track.dispatchEvent(new Event('ended'));
    expect(log.events).toEqual({ mute: 1, unmute: 1, ended: 1 });
    expect(log.readyState).toBe('ended');
    expect(log.muted).toBe(false);
    unbind();
    track.dispatchEvent(new Event('mute'));
    expect(log.events.mute).toBe(1);
    resetCameraTrackLog(log, { readyState: 'live', muted: true });
    expect(log.events).toEqual({ mute: 0, unmute: 0, ended: 0 });
    expect(log.readyState).toBe('live');
    expect(log.muted).toBe(true);
  });
});
