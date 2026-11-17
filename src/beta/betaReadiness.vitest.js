import { describe, expect, it, vi } from 'vitest';
import { createDiagnosticLog, EVENT_TTL_MS, MAX_EVENTS, observeDiagnosticLifecycle } from './diagnosticLog.js';
import { buildProblemReport } from './problemReport.js';
import { betaJsonFile, saveLocalFile, shareLocalFile } from './localFileShare.js';
import { createContribution, validateContribution } from './contribution.js';
import { v1Bean, v1Shot, v10Shot } from '../transfer/historicalFixtures.js';

describe('local beta diagnostics', () => {
  it('recovers across instances, deduplicates bursts, bounds storage and expires old events', () => {
    let value;
    let now = EVENT_TTL_MS;
    const storage = { getItem: () => value, setItem: (_, saved) => { value = saved; } };
    const log = createDiagnosticLog(storage, () => now);
    log.record('app', 'started');
    log.record('app', 'started');
    expect(log.snapshot()).toHaveLength(1);
    for (let i = 0; i < MAX_EVENTS + 5; i += 1) {
      now += 10;
      log.record('ble', i % 2 ? 'connected' : 'disconnected');
    }
    const restarted = createDiagnosticLog(storage, () => now);
    expect(restarted.snapshot()).toHaveLength(MAX_EVENTS);
    expect(restarted.snapshot().every(({ area }) => area === 'ble')).toBe(true);
    expect(value.length).toBeLessThan(24_000);
    now += EVENT_TTL_MS + 1;
    expect(restarted.snapshot()).toEqual([]);
    expect(value).toBe('[]');
    restarted.record('tracking', 'reader-error');
    restarted.clear();
    expect(log.snapshot()).toEqual([]);
  });

  it('captures error classes and lifecycle codes with memory fallback and no raw details', () => {
    const win = new EventTarget();
    const doc = new EventTarget();
    const log = createDiagnosticLog({ getItem: () => '[]', setItem: () => { throw new Error('Quota'); } });
    const stop = observeDiagnosticLifecycle(win, doc, log.record);
    const emit = (target, type, fields) => target.dispatchEvent(Object.assign(new Event(type), fields));
    emit(win, 'error', { error: new TypeError('private path'), filename: 'https://private.invalid' });
    emit(win, 'unhandledrejection', { reason: { name: 'private MAC address' } });
    doc.hidden = true;
    emit(doc, 'visibilitychange');
    emit(win, 'pagehide');
    emit(win, 'pageshow', { persisted: true });
    log.record('camera', 'permission-denied');
    log.record('ble', 'failed');
    log.record('ble', 'a real address would be rejected');
    stop();
    emit(win, 'error', { error: new Error('after cleanup') });
    const items = log.snapshot();
    expect(items.map(({ code }) => code)).toEqual(['started', 'error', 'rejection', 'hidden', 'page-hidden',
      'page-restored', 'permission-denied', 'failed']);
    expect(items[1].kind).toBe('TypeError');
    expect(items[2].kind).toBe('unknown');
    expect(JSON.stringify(items)).not.toMatch(/private|address|https/i);
  });

  it('limits a report to approved technical evidence even when trace and device carry extra fields', () => {
    const report = buildProblemReport({
      platform: 'android', description: '  camera paused  ',
      device: { androidVersion: '16', model: null, address: '00:11:22:33:44:55', name: 'Private device' },
      events: [
        { area: 'camera', code: 'live', ageSeconds: 1, payload: 'Private image' },
        { area: 'camera', code: 'Private reason', ageSeconds: 1 },
      ],
      trace: { shotId: 'private-shot', events: [{ notes: 'private note' }], scaleDiagnostics: {
        availability: 'current-session', notificationAvailability: 'observed', gapCount: 3, serialNumber: 'private serial',
      } },
    });
    expect(report).toMatchObject({ platform: 'android', description: 'camera paused', device: { androidVersion: '16', model: null },
      shotDeviceSummary: { eventCount: 1, weightGapCount: 3, sensorEvidence: 'scale-observations' } });
    expect(report.events).toEqual([{ area: 'camera', code: 'live', ageSeconds: 1 }]);
    expect(JSON.stringify(report)).not.toMatch(/private|00:11/i);
    expect(buildProblemReport({ platform: 'web', events: [] }).shotDeviceSummary).toBeNull();
  });
});

describe('explicit local file sharing', () => {
  const file = betaJsonFile({ version: 1 }, 'test.json');

  it('requires consent for both sharing and saving', async () => {
    const android = vi.fn();
    const download = vi.fn();
    expect(await shareLocalFile(file, {}, { native: true, android })).toBe('consent-required');
    expect(await saveLocalFile(file, {}, { native: false, download })).toBe('consent-required');
    expect(android).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('treats cancelled browser sharing as cancelled and offers a separate save fallback', async () => {
    const share = vi.fn().mockRejectedValueOnce(new DOMException('Cancelled', 'AbortError'))
      .mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce(undefined);
    const options = { native: false, browser: { canShare: () => true, share } };
    expect(await shareLocalFile(file, { consent: true }, options)).toBe('cancelled');
    expect(await shareLocalFile(file, { consent: true }, options)).toBe('fallback');
    expect(await shareLocalFile(file, { consent: true }, options)).toBe('share');
    expect(await shareLocalFile(file, { consent: true }, { native: false, browser: {} })).toBe('fallback');
    const download = vi.fn();
    expect(await saveLocalFile(file, { consent: true }, { native: false, download })).toBe('download-started');
    expect(download).toHaveBeenCalledWith('test.json', file);
  });

  it('distinguishes native chooser opening, failed sharing and cancelled file picking', async () => {
    const android = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ cancelled: true }).mockResolvedValueOnce({});
    const options = { native: true, android };
    expect(await shareLocalFile(file, { consent: true, feedback: true }, options)).toBe('chooser-opened');
    expect(android).toHaveBeenCalledWith(file, 'test.json', true, { feedback: true });
    expect(await shareLocalFile(file, { consent: true }, options)).toBe('fallback');
    expect(await saveLocalFile(file, { consent: true }, options)).toBe('cancelled');
    expect(await saveLocalFile(file, { consent: true }, options)).toBe('saved');
  });
});

const physicalShot = {
  ...v10Shot, id: 'private-shot', notes: 'private-note', thumbnail: 'private-image',
  shotProfileTiming: {
    version: 1, pressureSource: 'camera', scaleSource: 'native-ble', yieldSource: 'scale',
    pressureOriginMs: 0, scaleOriginMs: 50, extractionStartMs: 300, extractionEndMs: 27_300, clockDriftMs: 1,
    address: '00:11:22:33:44:55',
  },
  labPressureCurve: [{ tS: 0, bar: 0 }, { tS: 0.1, bar: 1.25 }, { tS: 1, bar: null }, { tS: 1.1, bar: 7.12 }],
  scaleFlowCurve: [{ tS: 0, weightG: 0 }, { tS: 0.1, weightG: 0.125 }, { tS: 2, weightG: 4 },
    { tS: 2.1, weightG: 4.5, address: '00:11:22:33:44:55' }],
  flairProfile: { preinfusionPressure: '2.4', preinfusionTime: '8', preinfusionEndTrigger: 'weight' },
  recommendationFollowed: false,
};

describe('beta shot contribution', () => {
  it('validates mixed ages while keeping gaps, recorded observations and field-specific provenance', async () => {
    const doc = await createContribution([v1Shot, physicalShot,
      { id: 'incomplete', actualYieldG: 0, shotProfileTiming: { version: 1, yieldSource: 'manual' } }], [v1Bean],
    { testerId: 'tester_42' });
    expect(await validateContribution(JSON.parse(JSON.stringify(doc)))).toEqual({ records: 3, distinctFingerprints: 3 });
    const [historical, modern, incomplete] = doc.records;
    expect(historical).toMatchObject({ grinder: { model: 'Sette 270Wi', macro: 13, micro: 'E' },
      measurements: { yieldG: { value: 36.125, source: 'unknown' } },
      sensors: { pressure: { source: 'unavailable' } }, bean: { roast: 'Medium' } });
    expect(modern).toMatchObject({
      measurements: { yieldG: { value: 36.125, source: 'physically-measured' }, recordedExtractionS: { value: 27, source: 'calculated' } },
      preparation: { flair: { preinfusionPressure: 2.4, preinfusionTime: 8, preinfusionEndTrigger: 'weight' } },
      recommendation: { nextSetting: { macro: 13, micro: 'E' }, previousRecommendationFollowed: false,
        algorithmVersion: null, recordingAppVersion: null },
      sensors: { pressure: { source: 'camera', gapBeforeIndices: [3] },
        weight: { source: 'native-ble', originMs: 50, gapBeforeIndices: [2] }, flow: { source: 'calculated-from-weight' } },
    });
    expect(modern.sensors.pressure.points[0]).toMatchObject({ tS: 0, bar: 0 });
    expect(modern.sensors.flow.intervals.map(({ fromTS, tS }) => [fromTS, tS])).toEqual([[0, 0.1], [2, 2.1]]);
    expect(incomplete.quality).toMatchObject({ incomplete: true, savedTimestampValid: false, missingMeasurements: ['doseG', 'durationS'] });
    expect(incomplete.measurements.yieldG).toEqual({ value: 0, source: 'manual' });
    expect(JSON.stringify(doc)).not.toMatch(/private-|00:11|Early espresso|Earliest saved shot|shot-early|2025-01/);
    expect(doc.testerId).toBe('tester_42');
  });

  it('excludes explicit simulations, keeps legacy unknown provenance, and flags reversed clock data', async () => {
    const simulated = { ...physicalShot, shotProfileTiming: { ...physicalShot.shotProfileTiming,
      pressureSource: 'simulated', scaleSource: 'simulated', yieldSource: 'scale' } };
    const unknown = { ...physicalShot, labPressureCurve: [{ tS: 3, bar: 3 }, { tS: 2, bar: 4 }], shotProfileTiming: undefined };
    const doc = await createContribution([simulated, unknown], []);
    const [a, b] = doc.records;
    expect(a.measurements.yieldG).toEqual({ value: null, source: 'unavailable' });
    expect(a.measurements.ratio).toEqual({ value: null, source: 'unavailable' });
    expect(a.sensors.pressure).toMatchObject({ source: 'simulation-excluded', points: [] });
    expect(a.sensors.weight).toMatchObject({ source: 'simulation-excluded', points: [] });
    expect(a.sensors.flow).toEqual({ source: 'unavailable', intervals: [] });
    expect(b.sensors.pressure).toMatchObject({ source: 'unknown', gapBeforeIndices: [1], inconsistentTimes: true });
    expect(b.quality.inconsistentTiming).toBe(true);
    await expect(validateContribution(doc)).resolves.toMatchObject({ records: 2 });
  });

  it('flags possible duplicates without persistent IDs, and rejects unsupported or modified input', async () => {
    const a = await createContribution([v1Shot, { ...v1Shot, id: 'different', notes: 'changed' }], [v1Bean]);
    const b = await createContribution([v1Shot], [v1Bean]);
    expect(a.exportId).not.toBe(b.exportId);
    expect(a.records.map((row) => row.possibleDuplicateInFile)).toEqual([false, true]);
    expect(a.records[0].contentSha256).toBe(b.records[0].contentSha256);
    expect(await validateContribution(a)).toEqual({ records: 2, distinctFingerprints: 1 });
    await expect(validateContribution({ ...a, dataCompatibilityVersion: 999 })).rejects.toThrow(/Unsupported/);
    await expect(validateContribution({ ...a, records: [{ ...a.records[0], possibleDuplicateInFile: true }] })).rejects.toThrow(/invalid/);
    b.records[0].measurements.yieldG.value += 1;
    await expect(validateContribution(b)).rejects.toThrow(/checksum/);
    b.records[0].grinder.personalName = 'unexpected';
    await expect(validateContribution(b)).rejects.toThrow(/structure/);
    await expect(createContribution([], [])).rejects.toThrow(/Select/);
    await expect(createContribution([v1Shot], [], { testerId: 'person@example.com' })).rejects.toThrow(/tester ID/);
  });
});
