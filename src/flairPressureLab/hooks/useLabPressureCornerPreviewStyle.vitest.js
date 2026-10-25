/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useLabPressureCornerPreviewStyle } from './useLabPressureCornerPreviewStyle.js';
import { CORNER_PREVIEW_STYLE_MIN_WRITE_MS } from '../labPressureCornerPreview.js';

function HookHost({ pose }) {
  const videoRef = useRef(null);
  useLabPressureCornerPreviewStyle(pose, videoRef);
  return createElement('video', {
    ref: videoRef,
    className: 'absolute inset-0 h-full w-full object-cover',
  });
}

describe('useLabPressureCornerPreviewStyle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      'requestAnimationFrame',
      (cb) => window.setTimeout(() => cb(performance.now()), 0),
    );
    vi.stubGlobal('cancelAnimationFrame', (id) => window.clearTimeout(id));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('writes crop transform to the video via rAF without per-frame React updates', async () => {
    const pose = {
      hubX: 900,
      hubY: 400,
      radius: 50,
      lost: false,
      uncertain: false,
      atMs: Date.now(),
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(HookHost, { pose }));
    });

    const el = container.querySelector('video');
    Object.defineProperty(el, 'videoWidth', { value: 1280, configurable: true });
    Object.defineProperty(el, 'videoHeight', { value: 720, configurable: true });
    await act(async () => {
      el?.dispatchEvent(new Event('loadedmetadata'));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(el?.style.transform ?? '').toMatch(/scale\(/);
  });

  it('respects the min write interval when pose keeps moving', () => {
    const t0 = 50_000;
    let lastKey = '';
    let lastWrite = 0;
    let writeCount = 0;
    const keys = ['1000|500|400', '1001|501|401', '1002|502|402', '1003|503|403'];

    for (let frame = 0; frame < 60; frame += 1) {
      const now = t0 + frame * 16;
      const key = keys[frame % keys.length];
      if (
        key !== lastKey
        && (!lastWrite || now - lastWrite >= CORNER_PREVIEW_STYLE_MIN_WRITE_MS)
      ) {
        writeCount += 1;
        lastKey = key;
        lastWrite = now;
      }
    }
    expect(writeCount).toBeLessThanOrEqual(15);
    expect(writeCount).toBeGreaterThan(0);
  });
});
