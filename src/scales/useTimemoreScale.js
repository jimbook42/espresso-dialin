import { useCallback, useEffect, useRef, useState } from 'react';
import { isScaleSimPickerEnabled } from '../config/scaleFlag.js';
import { createScaleSession } from './scaleSession.js';
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
  const [shotStartWeightBaselineG, setShotStartWeightBaselineG] = useState(0);
  const [instantFlowGs, setInstantFlowGs] = useState(null);
  const [liveFlowSeries, setLiveFlowSeries] = useState([]);

  const transportRef = useRef(null);
  const sessionRef = useRef(null);
  const rafRef = useRef(null);
  const recordingExtractionRef = useRef(false);
  const liveWeightRef = useRef(0);
  const isConnected = connectStatus === 'connected';
  const liveRelativeWeightG = Math.max(0, liveWeightG - shotStartWeightBaselineG);

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
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          liveWeightRef.current = g;
          setLiveWeightG(g);
        });
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
  }, [disposeSession]);

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
      setShotStartWeightBaselineG(0);
      setLiveWeightG(0);
      setInstantFlowGs(null);
    } catch (err) {
      console.warn('[scale] connect failed', err);
      setConnectStatus('error');
      transportRef.current = null;
    }
  }, [enabled, disposeTransport, buildTransport, attachSession]);

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
    const weightBeforeTare = liveWeightRef.current;
    setShotStartWeightBaselineG(weightBeforeTare);
    try {
      await transport.tare();
    } catch {
      /* keep software baseline so relative weight stays at zero */
    }
    await transport.startTimer();
    if (!usePreInfusion) {
      sessionRef.current?.beginExtractionTiming();
      recordingExtractionRef.current = true;
    }
  }, [enabled, connectStatus, usePreInfusion]);

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
    setShotStartWeightBaselineG(0);
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
  }, [enabled, connectStatus]);

  const notifyShotCancelled = useCallback(async () => {
    const transport = transportRef.current;
    if (!enabled || !transport || connectStatus !== 'connected') return;
    await transport.stopTimer().catch(() => {});
    sessionRef.current?.resetRecording();
    recordingExtractionRef.current = false;
    setShotStartWeightBaselineG(0);
    setInstantFlowGs(null);
    setLiveFlowSeries([]);
  }, [enabled, connectStatus]);

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
}
