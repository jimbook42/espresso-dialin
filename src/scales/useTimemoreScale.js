import { recordDiagnostic } from '../beta/diagnosticLog.js';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isScaleSimPickerEnabled } from '../config/scaleFlag.js';
import { isDevUrlSimScaleActive } from '../config/devUrlSimScale.js';
import { SCALE_DEVICES } from './scaleRegistry.js';
import { createScaleSession } from './scaleSession.js';
import {
  addedMassSinceStartG,
  beginShotWeightTracking,
  createShotWeightTracking,
  ingestShotWeightSample,
  noteShotTareOutcome,
  weightTriggersReady,
} from './scaleShotBaseline.js';
import { createSimulatedTransport } from './transport/simulatedTransport.js';
import { createBluetoothScaleTransport } from './transport/createBluetoothScaleTransport.js';
import { isAndroidApp } from '../native/androidShell.js';
import { rememberedAndroidScale } from './transport/androidGatt.js';
import { isWebBluetoothAvailable } from './transport/webBluetoothTransport.js';
import { roundYieldG } from './scaleShotStopSettle.js';
import { resolveSettledYieldG } from './scaleYieldSettleResolve.js';
import { publishScaleLiveWeight, resetScaleLiveWeightStore } from './scaleLiveWeightStore.js';

const noopAsync = async () => {};
const emptyFlowTrack = { flowGs: null, series: [] };
const emptyDisplayFlow = { smooth: emptyFlowTrack, detail: emptyFlowTrack };

function appendFlowEstimate(track, sample) {
  if (!sample) return track.flowGs == null ? track : { ...track, flowGs: null };
  const last = track.series.at(-1);
  const series = last?.tS === sample.tS
    ? [...track.series.slice(0, -1), { ...last, ...sample }]
    : [...track.series, sample];
  return { flowGs: sample.flowGs, series };
}

// A GATT subscription can succeed even when the selected peripheral never
// sends a weight the chosen scale protocol can decode.
async function connectVerifiedAndroidScale(transport, signal) {
  let timer;
  let confirmWeight;
  const weight = new Promise((resolve) => { confirmWeight = resolve; });
  const offWeight = transport.onWeight(({ weightG }) => {
    if (Number.isFinite(weightG)) confirmWeight({ weightG });
  });
  const offDisconnect = transport.onDisconnect?.(() => confirmWeight({ error: new Error('Scale disconnected during setup.') }));
  const abort = () => confirmWeight({ error: signal.reason });
  signal.addEventListener('abort', abort, { once: true });
  try {
    await transport.connect();
    signal.throwIfAborted();
    timer = setTimeout(() => confirmWeight({ error: new Error('No weight readings received from the scale.') }), 4000);
    const { error, weightG } = await weight;
    if (error) throw error;
    return weightG;
  } finally {
    clearTimeout(timer);
    offWeight();
    offDisconnect?.();
    signal.removeEventListener('abort', abort);
  }
}

/** @param {boolean} simAllowed */
export function resolveDefaultTransportKind(simAllowed) {
  return simAllowed ? 'sim' : 'ble';
}

/** @param {'sim' | 'ble'} transportKind @param {boolean} simAllowed */
export function resolveEffectiveTransportKind(transportKind, simAllowed) {
  if (transportKind === 'sim' && !simAllowed) return 'ble';
  return transportKind;
}

/**
 * BLE scale state for the shot timer (no UI — wire into App timer handlers).
 *
 * @param {{
 *   enabled: boolean,
 *   targetYieldG?: number,
 *   usePreInfusion?: boolean,
 *   preInfusionDurationS?: number,
 * }} options
 */
export function useTimemoreScale({
  enabled,
  scaleDeviceId = 'timemore-dot',
  targetYieldG = 36,
  usePreInfusion = false,
  preInfusionDurationS = 8,
  diagnosticsRef,
  liveWorkflowEntry,
  liveWorkflowActive,
  shotLocked = false,
  smoothFlow = true,
}) {
  const devUrlSim = !isAndroidApp && enabled && isDevUrlSimScaleActive();
  const simAllowed = !isAndroidApp && enabled && (isScaleSimPickerEnabled() || devUrlSim);
  const bleAvailable = isAndroidApp || isWebBluetoothAvailable();

  const [transportKind, setTransportKind] = useState(() => resolveDefaultTransportKind(simAllowed));
  const [connectStatus, setConnectStatus] = useState('idle');
  const [liveWeightG, setLiveWeightG] = useState(0);
  const [liveRelativeWeightG, setLiveRelativeWeightG] = useState(0);
  const [weightTriggersPrimed, setWeightTriggersPrimed] = useState(false);
  const [displayFlow, setDisplayFlow] = useState(emptyDisplayFlow);
  const [displayFlowOriginMs, setDisplayFlowOriginMs] = useState(null);
  const [liveFlowSeries, setLiveFlowSeries] = useState([]);
  const [flowSeriesEpoch, setFlowSeriesEpoch] = useState(0);
  const [batteryPercent, setBatteryPercent] = useState(null);
  const [foregroundEntry, setForegroundEntry] = useState(0);
  const [connectionSettled, setConnectionSettled] = useState(0);

  const transportRef = useRef(null);
  const pendingConnect = useRef(null);
  const pendingDisconnect = useRef(null);
  const nativeShotLocked = useRef(shotLocked);
  const nativeForeground = useRef(true);
  const foreground = useRef(globalThis.document?.visibilityState !== 'hidden');
  const intentionallyDisconnected = useRef(new Set());
  const selectedModel = useRef(scaleDeviceId);
  const handledEntry = useRef(null);
  const connectionRef = useRef(null);
  const sessionRef = useRef(null);
  const shotSessionRef = useRef(null);
  const interruptedMetricsRef = useRef(null);
  const unsubscribeDisconnectRef = useRef(null);
  const connectStatusRef = useRef(connectStatus);
  connectStatusRef.current = connectStatus;
  const liveWeightRef = useRef(0);
  const shotWeightTrackingRef = useRef(createShotWeightTracking());
  const yieldSettleSnapshotRef = useRef(null);

  const readRelativeShotWeightG = useCallback(() => {
    return addedMassSinceStartG(shotWeightTrackingRef.current, liveWeightRef.current);
  }, []);

  const publishWeightSnapshot = useCallback((liveG, relativeG, primed) => {
    publishScaleLiveWeight({
      liveWeightG: liveG,
      liveRelativeWeightG: relativeG,
      weightTriggersPrimed: primed,
      isConnected: connectStatusRef.current === 'connected',
      connectStatus: connectStatusRef.current,
    });
  }, []);

  const syncRelativeFromLive = useCallback((liveG) => {
    const tracking = shotWeightTrackingRef.current;
    ingestShotWeightSample(tracking, liveG);
    const added = addedMassSinceStartG(tracking, liveG);
    const primed = weightTriggersReady(tracking);
    setLiveRelativeWeightG(added);
    setWeightTriggersPrimed(primed);
    publishWeightSnapshot(liveG, added, primed);
  }, [publishWeightSnapshot]);

  const isConnected = connectStatus === 'connected';

  const disposeSession = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
  }, []);

  const disposeTransport = useCallback(async () => {
    unsubscribeDisconnectRef.current?.();
    unsubscribeDisconnectRef.current = null;
    disposeSession();
    if (connectionRef.current) {
      diagnosticsRef?.current?.disconnect();
      if (!connectionRef.current.identity.simulated) recordDiagnostic('ble', 'disconnected');
    }
    connectionRef.current = null;
    const t = transportRef.current;
    transportRef.current = null;
    if (!t) return pendingDisconnect.current;
    const cleanup = t.disconnect().catch(() => {});
    pendingDisconnect.current = cleanup;
    await cleanup;
    if (pendingDisconnect.current === cleanup) pendingDisconnect.current = null;
    if (isAndroidApp) setConnectionSettled((value) => value + 1);
  }, [disposeSession, diagnosticsRef]);

  const resetShotWeightTracking = useCallback(() => {
    shotWeightTrackingRef.current = createShotWeightTracking();
    setLiveRelativeWeightG(0);
    setWeightTriggersPrimed(false);
    publishWeightSnapshot(liveWeightRef.current, 0, false);
  }, [publishWeightSnapshot]);

  const disconnect = useCallback(async (intentional = true) => {
    if (isAndroidApp && intentional) intentionallyDisconnected.current.add(scaleDeviceId);
    if (sessionRef.current && sessionRef.current === shotSessionRef.current) {
      interruptedMetricsRef.current = sessionRef.current.getShotMetrics();
    }
    pendingConnect.current?.abort();
    setConnectStatus('idle');
    setDisplayFlow(emptyDisplayFlow);
    setLiveFlowSeries([]);
    setFlowSeriesEpoch((epoch) => epoch + 1);
    setBatteryPercent(null);
    resetShotWeightTracking();
    await disposeTransport();
  }, [disposeTransport, resetShotWeightTracking, scaleDeviceId]);

  useEffect(() => {
    if (!enabled) {
      resetScaleLiveWeightStore();
      if (!isAndroidApp) return undefined;
      let disabled = true;
      void Promise.resolve(pendingDisconnect.current).then(() => {
        if (disabled) setConnectStatus('idle');
      });
      return () => { disabled = false; };
    }
    return () => {
      handledEntry.current = null;
      pendingConnect.current?.abort();
      disposeTransport();
      resetScaleLiveWeightStore();
    };
  }, [enabled, disposeTransport]);

  useEffect(() => {
    publishScaleLiveWeight({
      isConnected: connectStatus === 'connected',
      connectStatus,
    });
  }, [connectStatus]);

  const attachSession = useCallback((transport) => {
    disposeSession();
    const appendDisplay = (key, sample) => setDisplayFlow((previous) => {
      const next = appendFlowEstimate(previous[key], sample);
      return next === previous[key] ? previous : { ...previous, [key]: next };
    });
    sessionRef.current = createScaleSession(transport, {
      onWeightObservation: (evt) => diagnosticsRef?.current?.weight(evt),
      onExtractionStart: (epoch) => {
        setDisplayFlowOriginMs(epoch);
        diagnosticsRef?.current?.extractionStart(epoch);
      },
      onLiveWeight: (g) => {
        liveWeightRef.current = g;
        setLiveWeightG(g);
        syncRelativeFromLive(g);
      },
      onDisplayFlowSample: (sample) => appendDisplay('smooth', sample),
      onDetailFlowSample: (sample) => appendDisplay('detail', sample),
      onLiveTimerS: () => {},
      onFlowSample: (sample) => {
        setLiveFlowSeries((prev) => {
          if (prev.length && prev[prev.length - 1].tS === sample.tS) return prev;
          return [...prev, sample];
        });
      },
      onBatteryPercent: (pct) => setBatteryPercent(pct),
    });
    sessionRef.current.setDisplayForeground(foreground.current);
  }, [disposeSession, syncRelativeFromLive, diagnosticsRef]);

  useEffect(() => {
    if (!simAllowed && transportKind === 'sim') {
      setTransportKind('ble');
    }
  }, [simAllowed, transportKind]);

  const buildTransport = useCallback((options) => {
    const kind = resolveEffectiveTransportKind(transportKind, simAllowed);
    if (kind === 'sim') {
      return createSimulatedTransport({
        targetYieldG: Number(targetYieldG) || 36,
        preinfusionDurationS: usePreInfusion ? preInfusionDurationS : 0,
        dripAfterStopS: devUrlSim ? 2.5 : 0,
        batteryPercent: 72,
      });
    }
    return createBluetoothScaleTransport(scaleDeviceId, options);
  }, [transportKind, simAllowed, scaleDeviceId, targetYieldG, usePreInfusion, preInfusionDurationS, devUrlSim]);

  const connect = useCallback(async (reconnect = false) => {
    if (!enabled || pendingConnect.current || (isAndroidApp && (nativeShotLocked.current
      || pendingDisconnect.current || !foreground.current || scaleDeviceId !== selectedModel.current))) return;
    const attempt = new AbortController();
    pendingConnect.current = attempt;
    attempt.reconnect = reconnect === true;
    attempt.model = scaleDeviceId;
    let transport;
    const simulated = resolveEffectiveTransportKind(transportKind, simAllowed) === 'sim';
    if (!simulated) recordDiagnostic('ble', reconnect === true ? 'reconnecting' : 'pairing');
    setConnectStatus('connecting');
    setBatteryPercent(null);
    try {
      await disposeTransport();
      attempt.signal.throwIfAborted();
      transport = buildTransport({ reconnect: reconnect === true, signal: attempt.signal });
      transportRef.current = transport;
      let initialWeightG = 0;
      if (isAndroidApp) initialWeightG = await connectVerifiedAndroidScale(transport, attempt.signal);
      else await transport.connect();
      attempt.signal.throwIfAborted();
      if (isAndroidApp && (!transport.isConnected() || nativeShotLocked.current || scaleDeviceId !== selectedModel.current)) {
        throw new Error('Scale connection ended before setup completed.');
      }
      transport.remember?.();
      intentionallyDisconnected.current.delete(scaleDeviceId);
      if (!simulated) recordDiagnostic('ble', 'connected');
      const identity = {
        model: simulated ? 'Simulated Timemore Dot'
          : SCALE_DEVICES.find(({ id }) => id === scaleDeviceId)?.label ?? 'Compatible scale',
        transport: simulated ? 'simulated' : isAndroidApp ? 'native-ble' : 'web-bluetooth',
        simulated,
      };
      connectionRef.current = { identity, model: scaleDeviceId, wallMs: Date.now() };
      diagnosticsRef?.current?.connect(identity, connectionRef.current.wallMs);
      attachSession(transport);
      unsubscribeDisconnectRef.current = transport.onDisconnect?.(() => {
        if (transportRef.current === transport) void disconnect(false);
      });
      setConnectStatus('connected');
      liveWeightRef.current = initialWeightG;
      resetShotWeightTracking();
      setLiveWeightG(initialWeightG);
      publishWeightSnapshot(initialWeightG, 0, false);
      setDisplayFlow(emptyDisplayFlow);
    } catch (err) {
      if (transport && transportRef.current === transport) await disposeTransport();
      else await transport?.disconnect().catch(() => {});
      if (!simulated) recordDiagnostic('ble', attempt.signal.aborted || err?.name === 'NotFoundError' ? 'cancelled' : 'failed');
      if (!attempt.signal.aborted) {
        if (reconnect !== true) console.warn('[scale] connect failed', err);
        setConnectStatus('error');
      } else if (isAndroidApp) setConnectStatus('idle');
    } finally {
      pendingConnect.current = null;
      if (isAndroidApp) setConnectionSettled((value) => value + 1);
    }
  }, [enabled, disposeTransport, buildTransport, attachSession, disconnect, resetShotWeightTracking, publishWeightSnapshot,
    transportKind, simAllowed, scaleDeviceId, diagnosticsRef]);

  useLayoutEffect(() => {
    nativeShotLocked.current = shotLocked;
    selectedModel.current = scaleDeviceId;
    if (isAndroidApp && pendingConnect.current
      && (shotLocked || pendingConnect.current.model !== scaleDeviceId
        || (!liveWorkflowActive && pendingConnect.current.reconnect))) {
      pendingConnect.current.abort();
    }
  }, [shotLocked, liveWorkflowActive, scaleDeviceId]);

  useEffect(() => {
    const updateForeground = () => {
      const visible = nativeForeground.current && document.visibilityState !== 'hidden';
      if (foreground.current === visible) return;
      foreground.current = visible;
      sessionRef.current?.setDisplayForeground(visible);
      if (!isAndroidApp) return;
      if (visible) setForegroundEntry((entry) => entry + 1);
      else if (pendingConnect.current?.reconnect) {
        pendingConnect.current.abort();
      }
    };
    const pause = () => { nativeForeground.current = false; updateForeground(); };
    const resume = () => { nativeForeground.current = true; updateForeground(); };
    document.addEventListener('visibilitychange', updateForeground);
    document.addEventListener('dialin-android-paused', pause);
    document.addEventListener('dialin-android-resumed', resume);
    return () => {
      document.removeEventListener('visibilitychange', updateForeground);
      document.removeEventListener('dialin-android-paused', pause);
      document.removeEventListener('dialin-android-resumed', resume);
    };
  }, []);

  useEffect(() => {
    if (!isAndroidApp) return;
    if (!liveWorkflowActive || !enabled) handledEntry.current = null;
    if (shotLocked) return;
    if (connectionRef.current && (connectionRef.current.model !== scaleDeviceId || !enabled)) {
      void disconnect(false);
      return;
    }
    if (!enabled || !liveWorkflowActive || !foreground.current || pendingDisconnect.current
      || intentionallyDisconnected.current.has(scaleDeviceId) || !rememberedAndroidScale(scaleDeviceId)) return;
    const last = handledEntry.current;
    if (last?.model === scaleDeviceId && last.workflow === liveWorkflowEntry && last.foreground === foregroundEntry) return;
    if (pendingConnect.current) return;
    handledEntry.current = { model: scaleDeviceId, workflow: liveWorkflowEntry, foreground: foregroundEntry };
    if (!connectionRef.current) void connect(true);
  }, [liveWorkflowEntry, liveWorkflowActive, enabled, shotLocked, scaleDeviceId, connect,
    foregroundEntry, connectionSettled, disconnect]);

  const devUrlAutoConnectRef = useRef(false);
  useEffect(() => {
    if (!devUrlSim || devUrlAutoConnectRef.current) return;
    devUrlAutoConnectRef.current = true;
    setTransportKind('sim');
    void connect();
  }, [devUrlSim, connect]);

  const recordScaleConnection = () => {
    const connection = connectionRef.current;
    if (connection) diagnosticsRef?.current?.connect(connection.identity, connection.wallMs);
  };

  const issueTare = useCallback(async (transport, command = () => transport.tare()) => {
    const trace = diagnosticsRef?.current;
    const evidence = connectionRef.current?.identity.simulated
      ? 'simulator command' : 'transport command result; physical tare acknowledgement unavailable';
    trace?.tare('requested', evidence);
    try {
      await command();
      trace?.tare('succeeded', evidence);
    } catch (error) {
      trace?.tare('failed', evidence);
      throw error;
    }
  }, [diagnosticsRef]);

  const tare = useCallback(async () => {
    if (!transportRef.current) return;
    const session = sessionRef.current;
    session?.setDisplayTaring(true);
    try {
      await issueTare(transportRef.current);
    } finally {
      if (sessionRef.current === session) session?.setDisplayTaring(false);
    }
  }, [issueTare]);

  const prepareShotWeightBaseline = useCallback(async () => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    setDisplayFlow(emptyDisplayFlow);
    setLiveFlowSeries([]);
    setFlowSeriesEpoch((epoch) => epoch + 1);
    sessionRef.current?.resetRecording();

    const weightAtStart = liveWeightRef.current;
    beginShotWeightTracking(shotWeightTrackingRef.current, weightAtStart);
    setLiveRelativeWeightG(0);
    setWeightTriggersPrimed(false);

    let tareSucceeded = true;
    try {
      await issueTare(transport);
    } catch {
      tareSucceeded = false;
    }
    noteShotTareOutcome(shotWeightTrackingRef.current, tareSucceeded);
    if (typeof transport.configureShotWeight === 'function') {
      transport.configureShotWeight({ anchorG: weightAtStart, tareSucceeded });
    } else if (!tareSucceeded) {
      liveWeightRef.current = weightAtStart;
    }
    syncRelativeFromLive(liveWeightRef.current);
  }, [enabled, connectStatus, syncRelativeFromLive, issueTare]);

  const notifyShotCountdownPrepare = useCallback(async () => {
    await prepareShotWeightBaseline();
  }, [prepareShotWeightBaseline]);

  const notifyShotStarted = useCallback(async ({ tareAlreadyDone = false, skipPreInfusion = false } = {}) => {
    interruptedMetricsRef.current = null;
    shotSessionRef.current = null;
    const transport = transportRef.current;
    const session = sessionRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    if (!tareAlreadyDone) {
      await prepareShotWeightBaseline();
    }

    if (connectionRef.current?.identity.model === 'Bookoo Themis') {
      await issueTare(transport, () => transport.startTimer());
    } else {
      await transport.startTimer();
    }
    if (sessionRef.current !== session) return;
    shotSessionRef.current = session;
    if (skipPreInfusion || !usePreInfusion) {
      session?.beginExtractionTiming();
    }
  }, [enabled, connectStatus, usePreInfusion, prepareShotWeightBaseline, issueTare]);

  const recordYieldSettleSample = useCallback(() => {
    const snap = yieldSettleSnapshotRef.current;
    if (!snap) return;
    const relativeG = readRelativeShotWeightG();
    snap.peakG = Math.max(snap.peakG, relativeG);
  }, [readRelativeShotWeightG]);

  const finalizeShotStop = useCallback(() => {
    const transport = transportRef.current;
    const interruptedMetrics = interruptedMetricsRef.current;
    interruptedMetricsRef.current = null;
    const sameSession = sessionRef.current === shotSessionRef.current;
    shotSessionRef.current = null;
    if (!enabled || !transport || connectStatus !== 'connected' || !sameSession) {
      yieldSettleSnapshotRef.current = null;
      return { yieldG: null, metrics: interruptedMetrics?.scaleFlowCurve.length ? interruptedMetrics : null };
    }
    sessionRef.current?.stopRecording();
    const metrics = sessionRef.current?.getShotMetrics() ?? null;
    const snap = yieldSettleSnapshotRef.current;
    const relativeNow = readRelativeShotWeightG();
    const yieldG = snap
      ? resolveSettledYieldG(snap.atStopG, snap.peakG, relativeNow)
      : roundYieldG(relativeNow);
    yieldSettleSnapshotRef.current = null;
    resetShotWeightTracking();
    setDisplayFlow(emptyDisplayFlow);
    setLiveFlowSeries([]);
    setFlowSeriesEpoch((epoch) => epoch + 1);
    const shotMetrics =
      metrics?.scaleFlowCurve?.length
        ? {
            scaleFlowCurve: metrics.scaleFlowCurve,
            scaleFlowRateGs: metrics.scaleFlowRateGs ?? null,
          }
        : null;
    return { yieldG, metrics: shotMetrics };
  }, [enabled, connectStatus, resetShotWeightTracking]);

  const notifyShotYieldSettleBegin = useCallback(() => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected' || sessionRef.current !== shotSessionRef.current) {
      return false;
    }
    const atStopG = readRelativeShotWeightG();
    yieldSettleSnapshotRef.current = { atStopG, peakG: atStopG };
    sessionRef.current?.endDisplayFlow();
    diagnosticsRef?.current?.event('yield-settlement-started', { weightG: atStopG });
    transport.stopTimer().catch(() => {});
    return true;
  }, [enabled, connectStatus, readRelativeShotWeightG, diagnosticsRef]);

  const notifyPreInfusionEnded = useCallback(async () => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    if (sessionRef.current !== shotSessionRef.current) return;
    sessionRef.current?.beginExtractionTiming();
    if (
      resolveEffectiveTransportKind(transportKind, simAllowed) === 'sim' &&
      typeof transport.endPreinfusion === 'function'
    ) {
      transport.endPreinfusion();
    }
  }, [enabled, connectStatus, transportKind, simAllowed]);

  const notifyShotStopped = useCallback(() => {
    notifyShotYieldSettleBegin();
    return finalizeShotStop();
  }, [notifyShotYieldSettleBegin, finalizeShotStop]);

  const notifyShotCancelled = useCallback(async () => {
    shotSessionRef.current = null;
    interruptedMetricsRef.current = null;
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    await transport.stopTimer().catch(() => {});
    sessionRef.current?.resetRecording();
    resetShotWeightTracking();
    yieldSettleSnapshotRef.current = null;
    setDisplayFlow(emptyDisplayFlow);
    setLiveFlowSeries([]);
    setFlowSeriesEpoch((epoch) => epoch + 1);
  }, [enabled, connectStatus, resetShotWeightTracking]);

  if (!enabled) {
    return {
      simAllowed: false,
      bleAvailable: false,
      transportKind: 'ble',
      setTransportKind: () => {},
      connectStatus: 'idle',
      isConnected: false,
      liveWeightG: 0,
      liveRelativeWeightG: 0,
      weightTriggersPrimed: false,
      displayFlowGs: null,
      displayFlowSeries: [],
      displayFlowOriginMs: null,
      liveFlowSeries: [],
      flowSeriesEpoch: 0,
      batteryPercent: null,
      connect: noopAsync,
      disconnect: noopAsync,
      tare: noopAsync,
      recordScaleConnection: () => {},
      notifyShotCountdownPrepare: noopAsync,
      notifyShotStarted: noopAsync,
      notifyPreInfusionEnded: noopAsync,
      notifyShotYieldSettleBegin: () => false,
      recordYieldSettleSample: () => {},
      finalizeShotYieldSettle: () => ({ yieldG: null, metrics: null }),
      notifyShotStopped: () => ({ yieldG: null, metrics: null }),
      notifyShotCancelled: noopAsync,
    };
  }

  const displayTrack = smoothFlow ? displayFlow.smooth : displayFlow.detail;
  return {
    simAllowed,
    bleAvailable,
    transportKind,
    setTransportKind,
    connectStatus,
    isConnected,
    liveWeightG,
    liveRelativeWeightG,
    weightTriggersPrimed,
    displayFlowGs: isConnected ? displayTrack.flowGs : null,
    displayFlowSeries: isConnected ? displayTrack.series : [],
    displayFlowOriginMs: isConnected ? displayFlowOriginMs : null,
    liveFlowSeries,
    flowSeriesEpoch,
    batteryPercent,
    connectionLocked: isAndroidApp && shotLocked,
    connect,
    reconnect: isAndroidApp && !isConnected && rememberedAndroidScale(scaleDeviceId) ? () => connect(true) : undefined,
    disconnect,
    tare,
    recordScaleConnection,
    notifyShotCountdownPrepare,
    notifyShotStarted,
    notifyPreInfusionEnded,
    notifyShotYieldSettleBegin,
    recordYieldSettleSample,
    finalizeShotYieldSettle: finalizeShotStop,
    notifyShotStopped,
    notifyShotCancelled,
  };
};
