import { useCallback, useEffect, useRef, useState } from 'react';
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
import { isWebBluetoothAvailable } from './transport/webBluetoothTransport.js';
import { roundYieldG } from './scaleShotStopSettle.js';
import { resolveSettledYieldG } from './scaleYieldSettleResolve.js';
import { publishScaleLiveWeight, resetScaleLiveWeightStore } from './scaleLiveWeightStore.js';

const noopAsync = async () => {};

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
}) {
  const devUrlSim = enabled && isDevUrlSimScaleActive();
  const simAllowed = enabled && (isScaleSimPickerEnabled() || devUrlSim);
  const bleAvailable = isWebBluetoothAvailable();

  const [transportKind, setTransportKind] = useState(() => resolveDefaultTransportKind(simAllowed));
  const [connectStatus, setConnectStatus] = useState('idle');
  const [liveWeightG, setLiveWeightG] = useState(0);
  const [liveRelativeWeightG, setLiveRelativeWeightG] = useState(0);
  const [weightTriggersPrimed, setWeightTriggersPrimed] = useState(false);
  const [instantFlowGs, setInstantFlowGs] = useState(null);
  const [liveFlowSeries, setLiveFlowSeries] = useState([]);
  const [flowSeriesEpoch, setFlowSeriesEpoch] = useState(0);
  const [batteryPercent, setBatteryPercent] = useState(null);

  const transportRef = useRef(null);
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
    if (connectionRef.current) diagnosticsRef?.current?.disconnect();
    connectionRef.current = null;
    const t = transportRef.current;
    transportRef.current = null;
    if (t) await t.disconnect().catch(() => {});
  }, [disposeSession, diagnosticsRef]);

  const resetShotWeightTracking = useCallback(() => {
    shotWeightTrackingRef.current = createShotWeightTracking();
    setLiveRelativeWeightG(0);
    setWeightTriggersPrimed(false);
    publishWeightSnapshot(liveWeightRef.current, 0, false);
  }, [publishWeightSnapshot]);

  const disconnect = useCallback(async () => {
    if (sessionRef.current && sessionRef.current === shotSessionRef.current) {
      interruptedMetricsRef.current = sessionRef.current.getShotMetrics();
    }
    setConnectStatus('idle');
    setInstantFlowGs(null);
    setLiveFlowSeries([]);
    setFlowSeriesEpoch((epoch) => epoch + 1);
    setBatteryPercent(null);
    resetShotWeightTracking();
    await disposeTransport();
  }, [disposeTransport, resetShotWeightTracking]);

  useEffect(() => {
    if (!enabled) {
      resetScaleLiveWeightStore();
      return undefined;
    }
    return () => {
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
    sessionRef.current = createScaleSession(transport, {
      onWeightObservation: (evt) => diagnosticsRef?.current?.weight(evt),
      onExtractionStart: (epoch) => diagnosticsRef?.current?.extractionStart(epoch),
      onLiveWeight: (g) => {
        liveWeightRef.current = g;
        setLiveWeightG(g);
        syncRelativeFromLive(g);
      },
      onInstantFlowGs: (f) => setInstantFlowGs(f),
      onLiveTimerS: () => {},
      onFlowSample: (sample) => {
        setLiveFlowSeries((prev) => {
          if (prev.length && prev[prev.length - 1].tS === sample.tS) return prev;
          return [...prev, sample];
        });
      },
      onBatteryPercent: (pct) => setBatteryPercent(pct),
    });
  }, [disposeSession, syncRelativeFromLive, diagnosticsRef]);

  useEffect(() => {
    if (!simAllowed && transportKind === 'sim') {
      setTransportKind('ble');
    }
  }, [simAllowed, transportKind]);

  const buildTransport = useCallback(() => {
    const kind = resolveEffectiveTransportKind(transportKind, simAllowed);
    if (kind === 'sim') {
      return createSimulatedTransport({
        targetYieldG: Number(targetYieldG) || 36,
        preinfusionDurationS: usePreInfusion ? preInfusionDurationS : 0,
        dripAfterStopS: devUrlSim ? 2.5 : 0,
        batteryPercent: 72,
      });
    }
    return createBluetoothScaleTransport(scaleDeviceId);
  }, [transportKind, simAllowed, scaleDeviceId, targetYieldG, usePreInfusion, preInfusionDurationS, devUrlSim]);

  const connect = useCallback(async () => {
    if (!enabled) return;
    setConnectStatus('connecting');
    setBatteryPercent(null);
    try {
      await disposeTransport();
      const transport = buildTransport();
      transportRef.current = transport;
      await transport.connect();
      const simulated = resolveEffectiveTransportKind(transportKind, simAllowed) === 'sim';
      const identity = {
        model: simulated ? 'Simulated Timemore Dot'
          : SCALE_DEVICES.find(({ id }) => id === scaleDeviceId)?.label ?? 'Compatible scale',
        transport: simulated ? 'simulated' : 'web-bluetooth',
        simulated,
      };
      connectionRef.current = { identity, wallMs: Date.now() };
      diagnosticsRef?.current?.connect(identity, connectionRef.current.wallMs);
      attachSession(transport);
      unsubscribeDisconnectRef.current = transport.onDisconnect?.(() => {
        if (transportRef.current === transport) void disconnect();
      });
      setConnectStatus('connected');
      liveWeightRef.current = 0;
      resetShotWeightTracking();
      setLiveWeightG(0);
      publishWeightSnapshot(0, 0, false);
      setInstantFlowGs(null);
    } catch (err) {
      console.warn('[scale] connect failed', err);
      setConnectStatus('error');
      transportRef.current = null;
    }
  }, [enabled, disposeTransport, buildTransport, attachSession, disconnect, resetShotWeightTracking,
    transportKind, simAllowed, scaleDeviceId, diagnosticsRef]);

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
    if (transportRef.current) await issueTare(transportRef.current);
  }, [issueTare]);

  const prepareShotWeightBaseline = useCallback(async () => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    setInstantFlowGs(null);
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
    setInstantFlowGs(null);
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
    setInstantFlowGs(null);
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
      instantFlowGs: null,
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
    instantFlowGs,
    liveFlowSeries,
    flowSeriesEpoch,
    batteryPercent,
    connect,
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
