import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NO_PRESSURE_READING_WARNING,
  clearReaderStallDiagnostics,
  commitReaderStallDiagnostics,
  createReaderStallDiagnostics,
  readRejectionEvidence,
  readerStallDiagnosticsForShot,
  recordReaderSample,
} from './readerStallDiagnostics.js';
import { exportLabShotReplayDownloads } from './labShotReplayExport.js';

afterEach(() => {
  clearReaderStallDiagnostics();
});

describe('reader stall diagnostics', () => {
  it('counts presented, read, published, duplicate and rejection buckets without storing pixels or bars', () => {
    const diag = createReaderStallDiagnostics(0);
    const videoA = { readyState: 2, requestVideoFrameCallback() {} };
    const videoB = { readyState: 1 };
    diag.presented(100);
    diag.presented(200);
    recordReaderSample(diag, {
      hadImage: true,
      read: { lost: true, duplicate: false, needleDeg: null, needleQuality: 0, rawBar: null },
      gated: { fresh: false, reason: 'pose-lost' },
      legacyScale: true,
    });
    recordReaderSample(diag, {
      repeated: true,
      gated: { fresh: false, reason: 'needle-missing' },
      legacyScale: false,
      publisherCounts: { publisher: 0, rate: 0, byReason: { 'needle-missing': 1 } },
    });
    recordReaderSample(diag, {
      hadImage: true,
      read: { lost: false, duplicate: true, needleDeg: null, rawBar: null, needleQuality: 0 },
      gated: { fresh: false, reason: 'needle-missing' },
      legacyScale: false,
      publisherCounts: { publisher: 0, rate: 0, byReason: { 'needle-missing': 2 } },
    });
    recordReaderSample(diag, {
      hadImage: true,
      read: { lost: false, needleDeg: 12, needleQuality: 0.01, rawBar: null },
      gated: { fresh: false, reason: 'needle-missing' },
      legacyScale: false,
      publisherCounts: { publisher: 0, rate: 0, byReason: {} },
    });
    recordReaderSample(diag, {
      hadImage: true,
      read: { lost: false, needleDeg: 40, needleQuality: 0.4, rawBar: null },
      gated: { fresh: false, reason: 'rate-unconfirmed' },
      legacyScale: false,
      publisherCounts: { publisher: 2, rate: 1, byReason: { 'rate-unconfirmed': 1, 'top-unconfirmed': 1 } },
    });
    expect(readRejectionEvidence({ lost: false, needleDeg: 40, needleQuality: 0.4, rawBar: null }))
      .toEqual({ endpointResolved: false, needleQualityPassed: true });
    diag.error(new Error('opencv failed'));
    diag.inferenceRejected('model hung');
    expect(diag.observe(2999, videoA, true, 'ready', {
      readyState: 'live', muted: false, events: { mute: 1, unmute: 0, ended: 0 },
    })).toBe(false);
    expect(diag.observe(3000, videoB, true, 'ready', {
      readyState: 'live', muted: true, events: { mute: 1, unmute: 0, ended: 0 },
    })).toBe(true);
    recordReaderSample(diag, {
      hadImage: true,
      read: { lost: false, needleDeg: 20, needleQuality: 0.5, rawBar: 4.2 },
      gated: { fresh: true, reason: 'tap-fresh' },
      legacyScale: false,
      publisherCounts: { publisher: 2, rate: 1, byReason: { 'rate-unconfirmed': 1 } },
      publishedAtMs: 3000,
    });
    expect(diag.observe(3000, videoB, false, 'ready', null)).toBe(false);
    diag.presented(3100);
    expect(diag.observe(7000, videoB, false, 'failed', null)).toBe(true);

    const snap = diag.snapshot();
    expect(snap.framesPresented).toBe(3);
    expect(snap.framesRead).toBe(5);
    expect(snap.framesConfident).toBe(1);
    expect(snap.duplicateFrames).toBe(2);
    expect(snap.rejectionReasons).toEqual({
      pose: 1, endpoint: 1, needleQuality: 1, publisher: 2, rate: 1,
    });
    expect(snap.longestGapMs).toBe(4000);
    expect(snap.callbackAgeMs).toBe(3900);
    expect(snap.lastReaderError).toBe('opencv failed');
    expect(snap.readerErrorCount).toBe(1);
    expect(snap.inferenceRejections).toBe(1);
    expect(snap.lastInferenceError).toBe('model hung');
    expect(snap.inferenceHung).toBe(false);
    expect(snap.videoElementChanges).toBe(1);
    expect(snap.cameraReadyState).toBe(1);
    expect(snap.callbackSupported).toBe(false);
    expect(snap.trackEvents.mute).toBe(1);
    expect(snap.modelStatus).toBe('failed');
    expect(JSON.stringify(snap)).not.toContain('4.2');
    expect(snap).not.toHaveProperty('bar');
    diag.stop();
    diag.presented(8000);
    expect(diag.snapshot().framesPresented).toBe(3);
  });

  it('marks inference hung only while a call stays busy for 3 s', () => {
    const diag = createReaderStallDiagnostics(0);
    diag.observe(0, null, true, 'loading', null);
    expect(diag.snapshot().inferenceHung).toBe(false);
    expect(diag.snapshot().inferenceBusy).toBe(true);
    diag.observe(3000, null, true, 'loading', null);
    expect(diag.snapshot()).toMatchObject({ inferenceHung: true, inferenceBusyMs: 3000 });
    diag.observe(3001, null, false, 'ready', null);
    expect(diag.snapshot().inferenceHung).toBe(false);
    expect(diag.snapshot().callbackAgeMs).toBeNull();
  });

  it('uses the no-reading warning string only as display copy', () => {
    expect(NO_PRESSURE_READING_WARNING).toBe('No pressure reading for 3 s – check the gauge is visible');
  });
});

describe('lab export with zero pressure samples', () => {
  it('downloads the stall summary when there is no replay video and no curve', async () => {
    const blobs = [];
    vi.stubGlobal('URL', {
      createObjectURL: (blob) => { blobs.push(blob); return 'blob:stall'; },
      revokeObjectURL: () => {},
    });
    vi.stubGlobal('document', {
      createElement: () => ({ setAttribute() {}, click() {} }),
      body: { appendChild() {}, removeChild() {} },
    });
    try {
      const summary = {
        framesPresented: 0,
        framesRead: 0,
        framesConfident: 0,
        duplicateFrames: 4,
        rejectionReasons: { pose: 0, endpoint: 0, needleQuality: 12, publisher: 0, rate: 0 },
        longestGapMs: 8200,
        callbackAgeMs: null,
        lastReaderError: null,
        readerErrorCount: 0,
        inferenceRejections: 1,
        inferenceHung: true,
        cameraReadyState: 0,
        trackReadyState: 'live',
        trackMuted: true,
        trackEvents: { mute: 1, unmute: 0, ended: 0 },
        videoElementChanges: 0,
      };
      commitReaderStallDiagnostics('empty-shot', summary);
      const shot = { id: 'empty-shot' };
      const exported = exportLabShotReplayDownloads({ shot });
      expect(exported.labPressureCurve).toEqual([]);
      expect(exported.readerStallDiagnostics).toMatchObject({
        shotId: 'empty-shot',
        framesPresented: 0,
        framesConfident: 0,
        longestGapMs: 8200,
        inferenceHung: true,
        trackMuted: true,
        rejectionReasons: { needleQuality: 12 },
      });
      expect(exported.readerStallDiagnostics).not.toHaveProperty('bar');
      const downloaded = JSON.parse(await blobs[0].text());
      expect(downloaded.labPressureCurve).toEqual([]);
      expect(downloaded.readerStallDiagnostics.framesRead).toBe(0);
      expect(downloaded.readerStallDiagnostics.duplicateFrames).toBe(4);
      expect(JSON.stringify(shot)).toBe(JSON.stringify({ id: 'empty-shot' }));
      expect(readerStallDiagnosticsForShot('other')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
