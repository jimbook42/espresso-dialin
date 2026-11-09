import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScaleSession } from './scaleSession.js';
import {
  createFlowEndDetector, flowAutoStopSettings, flowAutoStopWinningRule,
  FLOW_AUTO_STOP_ARM_MIN_GS, FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S,
  FLOW_AUTO_STOP_PLATEAU_HOLD_S, stepFlowEndDetector,
} from './flowEndAutoStop.js';
import { createShotDeviceDiagnostics, DIAGNOSTICS_UNAVAILABLE } from './shotDeviceDiagnostics.js';
import { buildShotDiagnosticDocument } from '../flairPressureLab/labShotReplayExport.js';
import { createShotLabPressureSession } from '../flairPressureLab/shotLabPressureSession.js';
import { SHOT_YIELD_SETTLE_MS } from './scaleShotStopSettle.js';

const buildSha = vi.hoisted(() => {
  const sha = '8a89237170266504cb6c3f3dd7759ae5fd4ab681';
  vi.stubEnv('VITE_APP_VERSION', '4.14.14');
  vi.stubEnv('VITE_APP_FULL_COMMIT_SHA', sha);
  return sha;
});

const epoch = 1_000_000;
const identity = { model: 'Simulated Timemore Dot', transport: 'simulated', simulated: true };
let nextId = 0;
afterEach(() => vi.useRealTimers());

function setup({ connected = true, legacyMode = false, enabled = true } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(epoch);
  const trace = createShotDeviceDiagnostics(flowAutoStopSettings(enabled, legacyMode));
  const pressure = createShotLabPressureSession();
  let detector = createFlowEndDetector();
  let pushWeight;
  const session = createScaleSession({
    onWeight: (callback) => { pushWeight = callback; return () => {}; },
    onTimer: () => () => {},
  }, {
    onWeightObservation: trace.weight,
    onExtractionStart: trace.extractionStart,
    onFlowSample: (sample) => {
      detector = stepFlowEndDetector(detector, sample, { enabled, legacyMode, observe: trace.detector });
    },
  });
  const at = (ms) => vi.setSystemTime(epoch + ms);
  if (connected) trace.connect(identity, epoch - 3000);
  trace.start(epoch, 100);
  at(30);
  pressure.begin(Date.now());
  trace.pressureStart(Date.now());
  at(2000);
  if (connected) session.beginExtractionTiming();

  return {
    at, trace, pressure, session,
    state: () => detector.auto,
    weight(ms, weightG) {
      at(ms);
      pushWeight({ weightG, timestampMs: Date.now() });
    },
    stop({ ms, automatic = false, pendingEndS = null, settled = false, yieldG = null }) {
      at(ms);
      trace.stop(automatic ? {
        mode: 'automatic', rule: flowAutoStopWinningRule(detector.auto), monotonicMs: 100 + ms,
        endExtractionS: detector.auto.recordedEndExtractionS,
      } : {
        mode: 'manual', rule: 'manual', monotonicMs: 100 + ms,
        pendingCandidate: pendingEndS == null ? 'none' : 'rejected', pendingEndExtractionS: pendingEndS,
      });
      if (settled) {
        trace.event('yield-settlement-started');
        at(ms + SHOT_YIELD_SETTLE_MS);
        trace.event('yield-settlement-completed');
      }
      trace.freeze({ settled, yieldG });
      const shot = {
        id: `diagnostic-test-${++nextId}`,
        actualTimeS: automatic ? Math.round(detector.auto.recordedEndExtractionS) : Math.round(ms / 1000),
        actualYieldG: yieldG,
        ...pressure.getShotMetrics(),
      };
      trace.save(shot);
      return { shot, document: buildShotDiagnosticDocument(shot) };
    },
  };
}

function pour(shot) {
  for (let i = 0; i <= 20; i += 1) shot.weight(2000 + i * 100, i * .2);
}

describe('shot diagnostic export', () => {
  it('loads an old-format pressure export with explicit unavailable provenance', () => {
    const old = JSON.parse('{"shotId":"old-shot","labPressureCurve":[{"tS":1,"bar":0}]}');
    const document = buildShotDiagnosticDocument({ id: old.shotId, labPressureCurve: old.labPressureCurve });
    expect(document).toMatchObject({
      ...old, diagnosticsVersion: 2, readerDiagnostics: null, recordingBuild: null,
      pressureDiagnosticsAvailability: 'saved-curve-only',
      stopDiagnosticsAvailability: DIAGNOSTICS_UNAVAILABLE,
      scaleDiagnostics: { availability: 'unavailable', reason: DIAGNOSTICS_UNAVAILABLE },
      exportBuild: { appVersion: '4.14.14', gitSha: buildSha },
    });
    expect(new Date(document.exportedAt).toISOString()).toBe(document.exportedAt);
  });

  it('captures a manual stop without a scale and leaves the shot record free of diagnostics', () => {
    const run = setup({ connected: false });
    run.pressure.pushRaw(0, true, epoch + 1200);
    const { shot, document } = run.stop({ ms: 5300 });
    expect(Object.keys(shot).sort()).toEqual(
      ['actualTimeS', 'actualYieldG', 'id', 'labPressureCurve', 'labPressurePeakBar'].sort(),
    );
    expect(document.scaleDiagnostics).toEqual({ availability: 'unavailable', reason: 'no scale connected during capture' });
    expect(document.events).toEqual([expect.objectContaining({ type: 'manual-stop', tMs: 5300 })]);
    expect(document.recordingBuild).toEqual(document.exportBuild);
    expect(document.final).toMatchObject({ actualTimeS: 5, mode: 'manual', rule: 'manual', pendingCandidate: 'none',
      confirmationMs: null, backdatedEndMs: null, savedYieldG: null, yieldSettlementCompleted: false });
    expect(buildShotDiagnosticDocument({ ...shot, id: 'other-shot' }).recordingBuild).toBeNull();
  });

  it('aligns unchanged pressure seconds with raw scale samples, tare and connection events', () => {
    const run = setup({ enabled: false });
    run.at(2001);
    run.trace.tare('requested', 'transport');
    run.weight(2002, 8.4);
    run.at(2003);
    run.trace.tare('failed', 'transport');
    run.weight(2004, 8.5);
    run.trace.tare('requested', 'transport');
    run.trace.tare('succeeded', 'transport');
    run.weight(2100, 0);
    run.at(2200);
    run.trace.disconnect();
    run.trace.connect(identity, epoch + 2700);
    run.weight(2800, 1.2);
    run.weight(3300, 1.2);
    run.pressure.pushRaw(0, true, epoch + 2100);
    const { document } = run.stop({ ms: 3400 });
    expect(document.timeline).toMatchObject({ pressureOffsetMs: 30, extractionOffsetMs: 2000, units: 'ms' });
    expect(document.labPressureCurve[0].tS * 1000 + document.timeline.pressureOffsetMs).toBeCloseTo(2100);
    expect(document.scaleDiagnostics.rawWeightSamples).toEqual([
      { tMs: 2002, weightG: 8.4, tareState: 'requested' },
      { tMs: 2004, weightG: 8.5, tareState: 'failed' },
      { tMs: 2100, weightG: 0, tareState: 'succeeded' },
      { tMs: 2800, weightG: 1.2, tareState: 'unknown' },
      { tMs: 3300, weightG: 1.2, tareState: 'unknown' },
    ]);
    expect(document.events.map(({ type }) => type)).toEqual([
      'connect', 'extraction-start', 'tare-requested', 'tare-failed', 'tare-requested',
      'tare-succeeded', 'disconnect', 'reconnect', 'manual-stop',
    ]);
    expect(document.scaleDiagnostics).toMatchObject({ identity, gapCount: 1, longestGapMs: 700,
      gaps: [{ startMs: 2100, endMs: 2800, durationMs: 700, endObserved: true,
        connectionEvents: [{ type: 'disconnect', tMs: 2200 }, { type: 'reconnect', tMs: 2700 }] }] });
  });

  it('exports plateau, fast EMA, confirmation, backdating and settlement from real detector transitions', () => {
    const run = setup();
    pour(run);
    let ms = 4100;
    for (; ms < 8000; ms += 100) {
      run.weight(ms, 4);
      if (run.state().stopConfirmed) break;
    }
    expect(run.state().stopConfirmed).toBe(true);
    run.trace.event('display-timer-frozen');
    const { shot, document } = run.stop({ ms, automatic: true, settled: true, yieldG: 4.2 });
    const event = (type) => document.events.find((item) => item.type === type);
    expect(event('flow-armed').smoothedFlowGs).toBeGreaterThanOrEqual(FLOW_AUTO_STOP_ARM_MIN_GS);
    expect(event('plateau-candidate-started')).toMatchObject({ tMs: 4300, candidateMs: 4000 });
    expect(event('fast-ema-candidate-started').candidateMs).toBeGreaterThan(4000);
    expect(event('stop-confirmed')).toMatchObject({ tMs: ms, selectedEndMs: 4000, rule: 'plateau' });
    expect(event('yield-settlement-completed').tMs - event('yield-settlement-started').tMs).toBe(SHOT_YIELD_SETTLE_MS);
    expect(document.final).toMatchObject({
      actualTimeS: 2, backdatedEndMs: 4000, confirmationMs: ms,
      savedYieldG: 4.2, rule: 'plateau', mode: 'automatic', yieldSettlementCompleted: true,
    });
    expect(document.autoStopSettings).toMatchObject({
      enabled: true, mode: 'current', armMinGs: FLOW_AUTO_STOP_ARM_MIN_GS,
      plateauHoldMs: FLOW_AUTO_STOP_PLATEAU_HOLD_S * 1000,
      maxNotificationGapMs: FLOW_AUTO_STOP_MAX_SAMPLE_GAP_S * 1000,
    });
    run.weight(ms + 6000, 99);
    run.trace.freeze({ settled: false, yieldG: 99 });
    run.trace.save({ ...shot, id: 'duplicate-shot', actualTimeS: 99 });
    expect(buildShotDiagnosticDocument(shot, document.exportedAt)).toEqual(document);
    expect(buildShotDiagnosticDocument({ id: 'duplicate-shot' }).recordingBuild).toBeNull();
  });

  it('records resumed weight clearing a candidate and manual rejection of a later pending end', () => {
    const run = setup();
    pour(run);
    for (let ms = 4100; ms <= 4700; ms += 100) run.weight(ms, 4);
    for (let i = 1; i <= 5; i += 1) run.weight(4700 + i * 100, 4 + i * .2);
    for (let ms = 5300; ms <= 5700; ms += 100) run.weight(ms, 5);
    const pendingEndS = run.state().plateauStartS;
    expect(pendingEndS).not.toBeNull();
    const { document } = run.stop({ ms: 5750, pendingEndS });
    expect(document.events).toContainEqual(expect.objectContaining({
      type: 'candidate-cleared', candidateMs: 4000, reason: 'resumed-weight',
      netGainG: expect.any(Number),
    }));
    expect(document.events.find(({ type }) => type === 'candidate-cleared').netGainG).toBeGreaterThanOrEqual(.5);
    expect(document.final).toMatchObject({ pendingCandidate: 'rejected', rule: 'manual', confirmationMs: null });
    expect(document.events.some(({ type }) => type === 'stop-confirmed')).toBe(false);
  });

  it.each([
    { legacyMode: false, rule: 'fast-ema', candidate: 'fast-ema-candidate-started', tailGainG: .02 },
    { legacyMode: true, rule: 'legacy-fallback', candidate: 'legacy-candidate-started', tailGainG: 0 },
  ])('reports the detector’s $rule result for its active mode', ({ legacyMode, rule, candidate, tailGainG }) => {
    const run = setup({ legacyMode });
    pour(run);
    let i = 1;
    for (; i <= 60 && !run.state().stopConfirmed; i += 1) run.weight(4000 + i * 100, 4 + i * tailGainG);
    expect(run.state().stopConfirmed).toBe(true);
    const { document } = run.stop({ ms: 4000 + (i - 1) * 100, automatic: true });
    expect(document.events).toContainEqual(expect.objectContaining({ type: candidate }));
    expect(document.final).toMatchObject({ rule, mode: 'automatic', confirmationMs: expect.any(Number) });
  });
});
