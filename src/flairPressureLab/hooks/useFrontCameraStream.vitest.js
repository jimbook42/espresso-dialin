/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useFrontCameraStream } from './useFrontCameraStream.js';

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
    const track = { getSettings: () => ({ facingMode }), stop: vi.fn(() => {
      if (!stopped) { stopped = true; active--; events.push(`stop:${facingMode}`); }
    }) };
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

describe('single camera facingMode switching', () => {
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
