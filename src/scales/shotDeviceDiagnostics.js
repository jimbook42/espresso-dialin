const RETAINED_SHOTS = 8;
const GAP_THRESHOLD_MS = 500;
const completedShots = new Map();

export const DIAGNOSTICS_UNAVAILABLE = 'unavailable: page reloaded or diagnostics were not retained';

export const diagnosticsBuild = {
  appVersion: import.meta.env.VITE_APP_VERSION || null,
  gitSha: import.meta.env.VITE_APP_FULL_COMMIT_SHA || null,
};

export function createShotDeviceDiagnostics(settings) {
  let origin = null;
  let extractionEpoch = null;
  let extractionPhaseEpoch = null;
  let pressureEpoch = null;
  let pressureSource = null;
  let final = null;
  let frozen = null;
  let saved = false;
  let tareState = 'unknown';
  let connected = false;
  let scaleIdentity = null;
  const rawWeightSamples = [];
  const events = [];
  const offset = (wallMs) => wallMs == null || !origin ? null : wallMs - origin.wallMs;
  const event = (type, data = {}, wallMs = Date.now()) => {
    if (!frozen) events.push({ type, wallMs, ...data });
  };

  return {
    start(wallMs, monotonicMs) {
      origin = { wallMs, monotonicMs };
    },
    extractionPhaseStart(wallMs = Date.now()) {
      if (extractionPhaseEpoch == null && !frozen) {
        extractionPhaseEpoch = wallMs;
        event('app-extraction-start', {}, wallMs);
      }
    },
    pressureStart(wallMs, simulated = false) {
      if (pressureEpoch != null || frozen) return;
      pressureEpoch = wallMs;
      pressureSource = simulated ? 'simulated' : 'camera';
    },
    extractionStart(wallMs) {
      if (frozen) return;
      extractionEpoch = wallMs;
      event('extraction-start', {}, wallMs);
    },
    connect(identity, wallMs = Date.now()) {
      if (frozen || connected || !identity) return;
      const safeIdentity = {
        model: identity.model,
        transport: identity.transport,
        simulated: identity.simulated === true,
      };
      event(scaleIdentity ? 'reconnect' : 'connect', { identity: safeIdentity }, wallMs);
      connected = true;
      scaleIdentity = safeIdentity;
      tareState = 'unknown';
    },
    disconnect() {
      if (frozen || !connected) return;
      connected = false;
      event('disconnect');
    },
    tare(state, evidence) {
      if (frozen) return;
      tareState = state;
      event(`tare-${state}`, { evidence });
    },
    weight({ timestampMs, weightG }) {
      if (frozen || !connected || !Number.isFinite(timestampMs) || !Number.isFinite(weightG)) return;
      rawWeightSamples.push({ wallMs: timestampMs, weightG, tareState });
    },
    detector({ type, tExtractionS, candidateS, selectedEndS, ...data }) {
      if (extractionEpoch == null) return;
      event(type, {
        ...data,
        candidateMs: offset(candidateS == null ? null : extractionEpoch + candidateS * 1000),
        selectedEndMs: offset(selectedEndS == null ? null : extractionEpoch + selectedEndS * 1000),
      }, extractionEpoch + tExtractionS * 1000);
    },
    event,
    stop({ monotonicMs, endExtractionS, pendingEndExtractionS, ...result }) {
      if (final || !origin) return;
      const stopMs = monotonicMs - origin.monotonicMs;
      final = {
        ...result,
        stopMs,
        wallClockDriftAtStopMs: offset(Date.now()) - stopMs,
        ...(result.mode === 'manual' ? {
          pendingEndMs: offset(pendingEndExtractionS == null || extractionEpoch == null
            ? null : extractionEpoch + pendingEndExtractionS * 1000),
        } : {}),
        backdatedEndMs: offset(endExtractionS == null || extractionEpoch == null
          ? null : extractionEpoch + endExtractionS * 1000),
      };
      if (result.mode === 'manual') event('manual-stop', final, origin.wallMs + stopMs);
    },
    freeze({ settled, yieldG }) {
      if (frozen || !origin || !final) return;
      const timedEvents = events.map(({ wallMs, ...entry }) => ({ ...entry, tMs: offset(wallMs) }));
      const samples = rawWeightSamples.map(({ wallMs, ...entry }) => ({ ...entry, tMs: offset(wallMs) }));
      const gaps = [];
      const connectionEvents = timedEvents.filter((entry) => ['connect', 'reconnect', 'disconnect'].includes(entry.type));
      const settleStartMs = timedEvents.find(({ type }) => type === 'yield-settlement-started')?.tMs;
      const addGap = (startMs, endMs, endObserved) => {
        const durationMs = endMs - startMs;
        if (durationMs <= GAP_THRESHOLD_MS) return;
        gaps.push({
          startMs, endMs, durationMs, endObserved,
          overlapsYieldSettlement: settleStartMs != null && endMs >= settleStartMs,
          connectionEvents: connectionEvents.filter(({ tMs }) => tMs >= startMs && tMs <= endMs),
        });
      };
      for (let i = 1; i < samples.length; i += 1) {
        addGap(samples[i - 1].tMs, samples[i].tMs, true);
      }
      if (samples.length) addGap(samples.at(-1).tMs, offset(Date.now()), false);
      frozen = {
        recordingBuild: diagnosticsBuild,
        pressureSource,
        timeline: {
          origin: 'application shot timer start',
          units: 'ms',
          pressureOffsetMs: offset(pressureEpoch),
          appExtractionOffsetMs: offset(extractionPhaseEpoch),
          extractionOffsetMs: offset(extractionEpoch),
          pressureMapping: 'labPressureCurve and reader frame seconds × 1000 + pressureOffsetMs',
          precision: 'pressure and scale use browser wall-clock observations; UI stop uses the monotonic shot clock',
          preStartEvents: 'negative timestamps precede the shot timer, including countdown and tare',
        },
        scaleDiagnostics: scaleIdentity ? {
          availability: 'current-session',
          identity: scaleIdentity,
          weightUnit: 'g',
          rawWeightSamples: samples,
          notificationAvailability: samples.length ? 'observed' : 'unavailable: no weight notifications observed',
          tareStateMeaning: 'transport command outcome; physical tare acknowledgement unavailable',
          retention: 'all observations from shot preparation through finalisation',
          gapThresholdMs: GAP_THRESHOLD_MS,
          gapCount: gaps.length,
          longestGapMs: gaps.length ? Math.max(...gaps.map(({ durationMs }) => durationMs)) : 0,
          gaps,
        } : { availability: 'unavailable', reason: 'no scale connected during capture' },
        autoStopSettings: settings,
        events: timedEvents,
        final: {
          ...final,
          confirmationMs: timedEvents.findLast(({ type }) => type === 'stop-confirmed')?.tMs ?? null,
          measuredYieldG: yieldG ?? null,
          displayTimerFrozen: timedEvents.some(({ type }) => type === 'display-timer-frozen'),
          yieldSettlementCompleted: settled,
        },
      };
    },
    save(shot) {
      if (saved || !frozen) return;
      saved = true;
      completedShots.set(String(shot.id), {
        ...frozen,
        final: {
          ...frozen.final,
          actualTimeS: shot.actualTimeS ?? null,
          savedYieldG: shot.actualYieldG ?? null,
        },
      });
      if (completedShots.size > RETAINED_SHOTS) completedShots.delete(completedShots.keys().next().value);
    },
  };
}

export function shotDeviceDiagnosticsForShot(shotId) {
  return completedShots.get(String(shotId)) ?? null;
}
