/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  bindCameraTrackEvents,
  createCameraTrackLog,
  resetCameraTrackLog,
  useFrontCameraStream,
} from './useFrontCameraStream.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
let current;
function Camera({ facingMode }) {
  current = useFrontCameraStream({ facingMode });
  useEffect(() => { void current.start(); return current.stop; }, [current.start, current.stop]);
  return createElement('video', { ref: current.videoRef });
}
function mediaFixture() {
  const events = [];
  let active = 0;
  let maximum = 0;
  const streams = [];
  const makeStream = (facingMode) => {
    active++;
    maximum = Math.max(maximum, active);
    let stopped = false;
    const track = Object.assign(new EventTarget(), { readyState: 'live', muted: false,
      getSettings: () => ({ facingMode, deviceId: `device-${facingMode}` }), stop: vi.fn(() => {
      if (!stopped) { stopped = true; active--; events.push(`stop:${facingMode}`); }
    }) });
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
    streams.push(stream);
    return stream;
  };
  vi.spyOn(HTMLMediaElement.prototype, 'srcObject', 'set').mockImplementation(function (value) {
    Object.defineProperty(this, 'srcObject', { value, writable: true, configurable: true });
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.stubEnv('VITE_PRESSURE_REPLAY', 'false');
  const container = document.createElement('div');
  root = createRoot(container);
  return { events, streams, makeStream, maximum: () => maximum };
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

describe('single camera facingMode switching', () => {
  it('reconnects the same device once, then requires a retry after another interruption', async () => {
    const fixture = mediaFixture();
    const getUserMedia = vi.fn(async () => fixture.makeStream('user'));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await act(async () => root.render(createElement(Camera)));
    const end = (index) => {
      const track = fixture.streams[index].getVideoTracks()[0];
      track.readyState = 'ended';
      track.dispatchEvent(new Event('ended'));
      track.dispatchEvent(new Event('ended'));
    };
    await act(async () => end(0));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[1][0].video.deviceId).toEqual({ exact: 'device-user' });
    expect(current.status).toBe('live');
    await act(async () => end(1));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(current.status).toBe('error');
    expect(current.error).toMatch(/Retry camera/);
    expect(current.videoRef.current.srcObject).toBeNull();
    await act(async () => current.retry());
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(current.status).toBe('live');
    expect(fixture.maximum()).toBe(1);
  });

  it('waits through mute and visibility changes without opening a second stream', async () => {
    const fixture = mediaFixture();
    const getUserMedia = vi.fn(async () => fixture.makeStream('user'));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    await act(async () => root.render(createElement(Camera)));
    const track = fixture.streams[0].getVideoTracks()[0];
    const update = (event, muted) => act(() => {
      track.muted = muted;
      track.dispatchEvent(new Event(event));
    });
    update('mute', true);
    expect(current.status).toBe('interrupted');
    update('unmute', false);
    expect(current.status).toBe('live');
    hidden.mockReturnValue(true);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(current.status).toBe('interrupted');
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(current.status).toBe('live');
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('defaults to user and releases the old tracks before opening environment', async () => {
    const fixture = mediaFixture();
    const getUserMedia = vi.fn(async ({ video }) => {
      fixture.events.push(`open:${video.facingMode.exact}`);
      return fixture.makeStream(video.facingMode.exact);
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await act(async () => root.render(createElement(Camera)));
    expect(getUserMedia.mock.calls[0][0].video.facingMode).toEqual({ exact: 'user' });
    await act(async () => root.render(createElement(Camera, { facingMode: 'environment' })));
    expect(getUserMedia.mock.calls[1][0].video.facingMode).toEqual({ exact: 'environment' });
    expect(fixture.events).toEqual(['open:user', 'stop:user', 'open:environment']);
    expect(current.videoRef.current.srcObject).toBe(fixture.streams[1]);
    expect(current.status).toBe('live');
    expect(fixture.maximum()).toBe(1);
  });

  it('serialises a flip during permission/startup so two streams never coexist', async () => {
    const fixture = mediaFixture();
    let resolveFirst;
    const getUserMedia = vi.fn(({ video }) => {
      fixture.events.push(`open:${video.facingMode.exact}`);
      if (getUserMedia.mock.calls.length === 1) return new Promise((resolve) => { resolveFirst = resolve; });
      return Promise.resolve(fixture.makeStream(video.facingMode.exact));
    });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await act(async () => root.render(createElement(Camera)));
    await act(async () => root.render(createElement(Camera, { facingMode: 'environment' })));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst(fixture.makeStream('user')));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(fixture.events).toEqual(['open:user', 'stop:user', 'open:environment']);
    expect(current.status).toBe('live');
    expect(fixture.maximum()).toBe(1);
  });
});
