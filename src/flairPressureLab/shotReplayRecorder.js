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
  /** @type {MediaRecorder | null} */
  let recorder = null;
  /** @type {Blob[]} */
  let chunks = [];
  let mimeType = '';
  let videoW = 0;
  let videoH = 0;
  let startedAtMs = 0;
  let maxStopTimer = 0;

  const clearMaxTimer = () => {
    if (maxStopTimer) {
      window.clearTimeout(maxStopTimer);
      maxStopTimer = 0;
    }
  };

  const abortInternal = () => {
    clearMaxTimer();
    if (recorder) {
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {
        // ignore
      }
    }
    recorder = null;
    chunks = [];
    mimeType = '';
    videoW = 0;
    videoH = 0;
    startedAtMs = 0;
  };

  return {
    start(stream, w, h) {
      abortInternal();
      const mime = pickShotReplayMimeType();
      if (!mime || !stream?.getVideoTracks?.().length) return false;
      try {
        chunks = [];
        mimeType = mime;
        videoW = w;
        videoH = h;
        startedAtMs = Date.now();
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: SHOT_REPLAY_TARGET_BITRATE,
        });
        recorder.ondataavailable = (ev) => {
          if (ev.data?.size > 0) chunks.push(ev.data);
        };
        recorder.start(1000);
        maxStopTimer = window.setTimeout(() => {
          try {
            if (recorder?.state === 'recording') recorder.stop();
          } catch {
            // ignore
          }
        }, SHOT_REPLAY_MAX_DURATION_S * 1000);
        return true;
      } catch {
        abortInternal();
        return false;
      }
    },
    stop() {
      clearMaxTimer();
      if (!recorder) return Promise.resolve(null);
      const rec = recorder;
      recorder = null;
      if (rec.state === 'inactive') {
        chunks = [];
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        const finish = () => {
          const durationS = Math.min(
            SHOT_REPLAY_MAX_DURATION_S,
            (Date.now() - startedAtMs) / 1000,
          );
          if (!chunks.length) {
            resolve(null);
            return;
          }
          const blob = new Blob(chunks, { type: mimeType });
          chunks = [];
          resolve({
            blob,
            mimeType,
            videoW,
            videoH,
            durationS,
          });
        };
        rec.onstop = finish;
        rec.onerror = () => {
          chunks = [];
          resolve(null);
        };
        try {
          rec.stop();
        } catch {
          chunks = [];
          resolve(null);
        }
      });
    },
    abort: abortInternal,
  };
}
