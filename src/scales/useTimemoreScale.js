import { useCallback, useEffect, useRef, useState } from 'react';
import { isScaleSimPickerEnabled } from '../config/scaleFlag.js';
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
import {
  createWebBluetoothTransport,
  isWebBluetoothAvailable,
} from './transport/webBluetoothTransport.js';

const noopAsync = async () => {};

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
  targetYieldG = 36,
  usePreInfusion = false,
  preInfusionDurationS = 8,
}) {
  const simAllowed = enabled && isScaleSimPickerEnabled();
  const bleAvailable = isWebBluetoothAvailable();

  const [transportKind, setTransportKind] = useState('sim');
  const [connectStatus, setConnectStatus] = useState('idle');
  const [liveWeightG, setLiveWeightG] = useState(0);
  const [liveRelativeWeightG, setLiveRelativeWeightG] = useState(0);
  const [weightTriggersPrimed, setWeightTriggersPrimed] = useState(false);
  const [instantFlowGs, setInstantFlowGs] = useState(null);
  const [liveFlowSeries, setLiveFlowSeries] = useState([]);

  const transportRef = useRef(null);
  const sessionRef = useRef(null);
  const rafRef = useRef(null);
  const recordingExtractionRef = useRef(false);
  const liveWeightRef = useRef(0);
  const shotWeightTrackingRef = useRef(createShotWeightTracking());

  const syncRelativeFromLive = useCallback((liveG) => {
    const tracking = shotWeightTrackingRef.current;
    ingestShotWeightSample(tracking, liveG);
    const added = addedMassSinceStartG(tracking, liveG);
    const primed = weightTriggersReady(tracking);
    setLiveRelativeWeightG(added);
    setWeightTriggersPrimed(primed);
  }, []);

  const isConnected = connectStatus === 'connected';

  const disposeSession = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    recordingExtractionRef.current = false;
  }, []);

  const disposeTransport = useCallback(async () => {
    disposeSession();
    const t = transportRef.current;
    transportRef.current = null;
    if (t) await t.disconnect().catch(() => {});
  }, [disposeSession]);

  const resetShotWeightTracking = useCallback(() => {
    shotWeightTrackingRef.current = createShotWeightTracking();
    setLiveRelativeWeightG(0);
    setWeightTriggersPrimed(false);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    return () => {
      disposeTransport();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, disposeTransport]);

  const attachSession = useCallback((transport) => {
    disposeSession();
    sessionRef.current = createScaleSession(transport, {
      onLiveWeight: (g) => {
        liveWeightRef.current = g;
        syncRelativeFromLive(g);
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null;
            setLiveWeightG(liveWeightRef.current);
          });
        }
      },
      onInstantFlowGs: (f) => setInstantFlowGs(f),
      onLiveTimerS: () => {},
      onFlowSample: (sample) => {
        setLiveFlowSeries((prev) => {
          if (prev.length && prev[prev.length - 1].tS === sample.tS) return prev;
          return [...prev, sample];
        });
      },
    });
  }, [disposeSession, syncRelativeFromLive]);

  const buildTransport = useCallback(() => {
    if (transportKind === 'sim') {
      return createSimulatedTransport({
        targetYieldG: Number(targetYieldG) || 36,
        preinfusionDurationS: usePreInfusion ? preInfusionDurationS : 0,
      });
    }
    return createWebBluetoothTransport();
  }, [transportKind, targetYieldG, usePreInfusion, preInfusionDurationS]);

  const connect = useCallback(async () => {
    if (!enabled) return;
    setConnectStatus('connecting');
    try {
      await disposeTransport();
      const transport = buildTransport();
      transportRef.current = transport;
      await transport.connect();
      attachSession(transport);
      setConnectStatus('connected');
      liveWeightRef.current = 0;
      resetShotWeightTracking();
      setLiveWeightG(0);
      setInstantFlowGs(null);
    } catch (err) {
      console.warn('[scale] connect failed', err);
      setConnectStatus('error');
      transportRef.current = null;
    }
  }, [enabled, disposeTransport, buildTransport, attachSession, resetShotWeightTracking]);

  const disconnect = useCallback(async () => {
    setConnectStatus('idle');
    setInstantFlowGs(null);
    await disposeTransport();
  }, [disposeTransport]);

  const tare = useCallback(async () => {
    await transportRef.current?.tare();
  }, []);

  const notifyShotStarted = useCallback(async () => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    setInstantFlowGs(null);
    setLiveFlowSeries([]);
    sessionRef.current?.resetRecording();
    recordingExtractionRef.current = false;

    const weightAtStart = liveWeightRef.current;
    beginShotWeightTracking(shotWeightTrackingRef.current, weightAtStart);
    setLiveRelativeWeightG(0);
    setWeightTriggersPrimed(false);

    let tareSucceeded = true;
    try {
      await transport.tare();
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

    await transport.startTimer();
    if (!usePreInfusion) {
      sessionRef.current?.beginExtractionTiming();
      recordingExtractionRef.current = true;
    }
  }, [enabled, connectStatus, usePreInfusion, syncRelativeFromLive]);

  const notifyPreInfusionEnded = useCallback(async () => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    sessionRef.current?.beginExtractionTiming();
    recordingExtractionRef.current = true;
    if (transportKind === 'sim' && typeof transport.endPreinfusion === 'function') {
      transport.endPreinfusion();
    }
  }, [enabled, connectStatus, transportKind]);

  const notifyShotStopped = useCallback(() => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') {
      return { yieldG: null, metrics: null };
    }
    transport.stopTimer().catch(() => {});
    sessionRef.current?.stopRecording();
    const metrics = sessionRef.current?.getShotMetrics() ?? null;
    const yieldG = Math.max(0, Math.round(liveWeightRef.current * 10) / 10);
    recordingExtractionRef.current = false;
    resetShotWeightTracking();
    setInstantFlowGs(null);
    setLiveFlowSeries([]);
    const shotMetrics =
      metrics?.scaleFlowCurve?.length
        ? {
            scaleFlowCurve: metrics.scaleFlowCurve,
            scaleFlowRateGs: metrics.scaleFlowRateGs ?? null,
          }
        : null;
    return { yieldG, metrics: shotMetrics };
  }, [enabled, connectStatus, resetShotWeightTracking]);

  const notifyShotCancelled = useCallback(async () => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    await transport.stopTimer().catch(() => {});
    sessionRef.current?.resetRecording();
    recordingExtractionRef.current = false;
    resetShotWeightTracking();
    setInstantFlowGs(null);
    setLiveFlowSeries([]);
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
      connect: noopAsync,
      disconnect: noopAsync,
      tare: noopAsync,
      notifyShotStarted: noopAsync,
      notifyPreInfusionEnded: noopAsync,
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
    connect,
    disconnect,
    tare,
    notifyShotStarted,
    notifyPreInfusionEnded,
    notifyShotStopped,
    notifyShotCancelled,
  };
};
