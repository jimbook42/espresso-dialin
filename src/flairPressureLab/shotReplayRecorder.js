/** Low-bitrate Lab shot replay — MediaRecorder only; no per-frame canvas work. */

export const SHOT_REPLAY_TARGET_BITRATE = 1_200_000;
export const SHOT_REPLAY_MAX_DURATION_S = 90;

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
  'video/webm',
];

export function pickShotReplayMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const mime of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * @returns {{
 *   start: (stream: MediaStream, videoW: number, videoH: number) => boolean,
 *   stop: () => Promise<{ blob: Blob, mimeType: string, videoW: number, videoH: number, durationS: number } | null>,
 *   abort: () => void,
 * }}
 */
export function createShotReplayRecorder() {
  let capture = null;

  const abortInternal = () => {
    const current = capture;
    capture = null;
    current?.abort();
  };

  return {
    start(stream, videoW, videoH) {
      abortInternal();
      const mimeType = pickShotReplayMimeType();
      if (!mimeType || !stream?.getVideoTracks?.().length) return false;
      try {
        const startedAtMs = Date.now();
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: SHOT_REPLAY_TARGET_BITRATE,
        });
        const chunks = [];
        let stoppedAtMs = null;
        let maxStopTimer;
        let resolveResult;
        const result = new Promise((resolve) => { resolveResult = resolve; });
        const finish = (value) => {
          window.clearTimeout(maxStopTimer);
          recorder.ondataavailable = null;
          recorder.onstop = null;
          recorder.onerror = null;
          chunks.length = 0;
          resolveResult(value);
        };
        const stopRecording = () => {
          if (recorder.state === 'inactive') return;
          stoppedAtMs = Date.now();
          try {
            recorder.stop();
          } catch {
            finish(null);
          }
        };

        recorder.ondataavailable = (ev) => {
          if (ev.data?.size > 0) chunks.push(ev.data);
        };
        // Finalize even when the duration cap fires before the shot ends.
        recorder.onstop = () => {
          const durationS = Math.min(
            SHOT_REPLAY_MAX_DURATION_S,
            ((stoppedAtMs ?? Date.now()) - startedAtMs) / 1000,
          );
          const blob = chunks.length ? new Blob(chunks, { type: mimeType }) : null;
          finish(blob ? { blob, mimeType, videoW, videoH, durationS } : null);
        };
        recorder.onerror = () => finish(null);
        capture = {
          result,
          stop: stopRecording,
          abort() {
            finish(null);
            stopRecording();
          },
        };
        recorder.start(1000);
        maxStopTimer = window.setTimeout(stopRecording, SHOT_REPLAY_MAX_DURATION_S * 1000);
        return true;
      } catch {
        abortInternal();
        return false;
      }
    },
    stop() {
      const current = capture;
      capture = null;
      current?.stop();
      return current?.result ?? Promise.resolve(null);
    },
    abort: abortInternal,
  };
}
