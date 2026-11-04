/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const saveLastLabShotReplay = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../labShotReplayDb.js', () => ({ saveLastLabShotReplay }));

import { useLabShotReplay } from './useLabShotReplay.js';
import {
  clearReaderStallDiagnostics,
  readerStallDiagnosticsForShot,
} from '../readerStallDiagnostics.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  saveLastLabShotReplay.mockClear();
  clearReaderStallDiagnostics();
  document.body.innerHTML = '';
});

describe('lab replay keeps a zero-sample stall summary', () => {
  it('commits reader diagnostics when the shot has no video and no samples', async () => {
    const stallRef = { current: null };
    const commitRef = { current: null };
    function Host() {
      const [running, setRunning] = useState(true);
      const videoRef = useRef(null);
      const observerRef = useRef(null);
      const discardRef = useRef(null);
      if (!running) {
        stallRef.current = {
          framesPresented: 0,
          framesRead: 0,
          framesConfident: 0,
          longestGapMs: 5000,
          callbackAgeMs: null,
          rejectionReasons: { pose: 0, endpoint: 0, needleQuality: 0, publisher: 0, rate: 0 },
        };
      }
      useLabShotReplay({
        enabled: true,
        timerRunning: running,
        videoRef,
        replayFrameObserverRef: observerRef,
        shotReplayCommitRef: commitRef,
        shotReplayDiscardRef: discardRef,
        readerStallSnapshotRef: stallRef,
      });
      return createElement('button', { type: 'button', onClick: () => setRunning(false) }, 'stop');
    }
    const container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(Host)));
    await act(async () => {
      container.querySelector('button').click();
      await Promise.resolve();
    });
    expect(saveLastLabShotReplay).not.toHaveBeenCalled();
    await act(async () => {
      await commitRef.current?.('shot-empty');
    });
    expect(saveLastLabShotReplay).not.toHaveBeenCalled();
    expect(readerStallDiagnosticsForShot('shot-empty')).toMatchObject({
      shotId: 'shot-empty',
      framesPresented: 0,
      framesConfident: 0,
      longestGapMs: 5000,
    });
  });
});
