import { useCallback, useEffect, useRef, useState } from 'react';
import { isScaleSimPickerEnabled } from '../config/scaleFlag.js';
import { createScaleSession } from '../scales/scaleSession.js';
import { createSimulatedTransport } from '../scales/transport/simulatedTransport.js';
import {
  createWebBluetoothTransport,
  isWebBluetoothAvailable,
} from '../scales/transport/webBluetoothTransport.js';

/**
 * @param {{
 *   ui: Record<string, string>,
 *   targetYieldG?: number,
 *   usePreInfusion?: boolean,
 *   preInfusionDurationS?: number,
 *   onYieldChange: (g: string) => void,
 *   onTimeChange: (s: string) => void,
 *   onMetricsReady: (metrics: { scaleFlowCurve: object[], scaleFlowRateGs: number | null } | null) => void,
 * }} props
 */
export function ScalePanel({
  ui,
  targetYieldG = 36,
  usePreInfusion = false,
  preInfusionDurationS = 8,
  onYieldChange,
  onTimeChange,
  onMetricsReady,
}) {
  const simAllowed = isScaleSimPickerEnabled();
  const bleAvailable = isWebBluetoothAvailable();

  const [transportKind, setTransportKind] = useState(simAllowed ? 'sim' : 'ble');
  const [status, setStatus] = useState('idle');
  const [liveWeightG, setLiveWeightG] = useState(0);
  const [liveTimerS, setLiveTimerS] = useState(0);
  const [instantFlowGs, setInstantFlowGs] = useState(null);
  const [preInfusionActive, setPreInfusionActive] = useState(false);
  const [shotActive, setShotActive] = useState(false);

  const transportRef = useRef(null);
  const sessionRef = useRef(null);
  const rafRef = useRef(null);
  const extractionStartMsRef = useRef(null);

  const disposeSession = useCallback(() => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
  }, []);

  const disposeTransport = useCallback(async () => {
    disposeSession();
    const t = transportRef.current;
    transportRef.current = null;
    if (t) await t.disconnect().catch(() => {});
  }, [disposeSession]);

  useEffect(() => () => {
    disposeTransport();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, [disposeTransport]);

  const attachSession = (transport) => {
    disposeSession();
    sessionRef.current = createScaleSession(transport, {
      onLiveWeight: (g) => {
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setLiveWeightG(g);
        });
      },
      onLiveTimerS: (s) => setLiveTimerS(s),
      onInstantFlowGs: (f) => setInstantFlowGs(f),
    });
  };

  const buildTransport = () => {
    if (transportKind === 'sim') {
      return createSimulatedTransport({
        targetYieldG: Number(targetYieldG) || 36,
        preinfusionDurationS: usePreInfusion ? preInfusionDurationS : 0,
      });
    }
    return createWebBluetoothTransport();
  };

  const handleConnect = async () => {
    setStatus('connecting');
    try {
      await disposeTransport();
      const transport = buildTransport();
      transportRef.current = transport;
      await transport.connect();
      attachSession(transport);
      setStatus('connected');
      setLiveWeightG(0);
      setLiveTimerS(0);
      onMetricsReady(null);
    } catch (err) {
      console.warn('[scale] connect failed', err);
      setStatus('error');
      transportRef.current = null;
    }
  };

  const handleDisconnect = async () => {
    setShotActive(false);
    setPreInfusionActive(false);
    setStatus('idle');
    onMetricsReady(null);
    await disposeTransport();
  };

  const runLocalTimer = () => {
    if (!extractionStartMsRef.current) return;
    const elapsed = (Date.now() - extractionStartMsRef.current) / 1000;
    setLiveTimerS(elapsed);
  };

  const handleStartShot = async () => {
    const transport = transportRef.current;
    if (!transport || status !== 'connected') return;
    setShotActive(true);
    setPreInfusionActive(!!usePreInfusion);
    extractionStartMsRef.current = null;
    setLiveTimerS(0);
    setInstantFlowGs(null);
    sessionRef.current?.resetRecording();
    onMetricsReady(null);
    await transport.startTimer();
    if (!usePreInfusion) {
      sessionRef.current?.beginExtractionTiming();
      extractionStartMsRef.current = Date.now();
    }
  };

  const handleEndPreInfusion = async () => {
    const transport = transportRef.current;
    if (!transport || !shotActive) return;
    setPreInfusionActive(false);
    sessionRef.current?.beginExtractionTiming();
    extractionStartMsRef.current = Date.now();
    if (transportKind === 'sim' && typeof transport.endPreinfusion === 'function') {
      transport.endPreinfusion();
    } else {
      await transport.startTimer();
    }
  };

  const handleStopShot = async () => {
    const transport = transportRef.current;
    if (!transport) return;
    await transport.stopTimer();
    sessionRef.current?.stopRecording();
    const metrics = sessionRef.current?.getShotMetrics() ?? null;
    const roundedTime = Math.max(0, Math.round(liveTimerS));
    const roundedYield = Math.max(0, Math.round(liveWeightG * 10) / 10);
    onTimeChange(String(roundedTime));
    onYieldChange(String(roundedYield));
    if (metrics?.scaleFlowCurve?.length) {
      onMetricsReady(metrics);
    } else {
      onMetricsReady(null);
    }
    setShotActive(false);
    setPreInfusionActive(false);
  };

  useEffect(() => {
    if (!shotActive || preInfusionActive) return undefined;
    const id = setInterval(runLocalTimer, 100);
    return () => clearInterval(id);
  }, [shotActive, preInfusionActive]);

  const showConnect = bleAvailable || simAllowed;
  if (!showConnect && !simAllowed) {
    return null;
  }

  return (
    <div className={`${ui.card} p-4 rounded-2xl space-y-3`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[10px] uppercase tracking-widest ${ui.muted}`}>Scale (Timemore Dot)</p>
        {status === 'connected' && (
          <span className="text-[10px] font-semibold text-[#8a9d72]">Connected</span>
        )}
      </div>

      {simAllowed && (
        <label className={`text-[10px] ${ui.muted} flex items-center gap-2`}>
          Transport
          <select
            value={transportKind}
            disabled={status === 'connected' || status === 'connecting'}
            onChange={(e) => setTransportKind(e.target.value)}
            className={`${ui.chip} text-xs rounded-lg px-2 py-1`}
          >
            <option value="sim">Simulated (QA)</option>
            <option value="ble" disabled={!bleAvailable}>Web Bluetooth</option>
          </select>
        </label>
      )}

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className={`${ui.metricCell} p-2 rounded-xl`}>
          <span className={`block text-[8px] uppercase ${ui.muted}`}>Live weight</span>
          <strong className={`text-lg font-black ${ui.text}`}>{liveWeightG.toFixed(1)}g</strong>
        </div>
        <div className={`${ui.metricCell} p-2 rounded-xl`}>
          <span className={`block text-[8px] uppercase ${ui.muted}`}>Yield</span>
          <strong className={`text-lg font-black ${ui.text}`}>{liveWeightG.toFixed(1)}g</strong>
        </div>
        <div className={`${ui.metricCell} p-2 rounded-xl`}>
          <span className={`block text-[8px] uppercase ${ui.muted}`}>Shot time</span>
          <strong className={`text-lg font-black ${ui.text}`}>{liveTimerS.toFixed(1)}s</strong>
        </div>
      </div>

      {instantFlowGs != null && shotActive && !preInfusionActive && (
        <p className={`text-[10px] ${ui.muted} text-center`}>
          Flow ~ <span className={`${ui.accentText} font-semibold`}>{instantFlowGs.toFixed(2)} g/s</span>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status !== 'connected' ? (
          <button
            type="button"
            onClick={handleConnect}
            disabled={status === 'connecting' || (transportKind === 'ble' && !bleAvailable)}
            className="flex-1 min-w-[120px] py-2 rounded-xl text-xs font-bold bg-[#c88a4b] text-[#121110] disabled:opacity-40"
          >
            {status === 'connecting' ? 'Connecting…' : 'Connect scale'}
          </button>
        ) : (
          <>
            {!shotActive && (
              <button
                type="button"
                onClick={handleStartShot}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-[rgba(200,138,75,0.15)] text-[#c88a4b] border border-[rgba(200,138,75,0.35)]"
              >
                Start shot
              </button>
            )}
            {shotActive && usePreInfusion && preInfusionActive && (
              <button
                type="button"
                onClick={handleEndPreInfusion}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-[#c88a4b] text-[#121110]"
              >
                End pre-infusion
              </button>
            )}
            {shotActive && (!usePreInfusion || !preInfusionActive) && (
              <button
                type="button"
                onClick={handleStopShot}
                className="flex-1 py-2 rounded-xl text-xs font-bold bg-[#8a9d72] text-[#121110]"
              >
                Stop shot
              </button>
            )}
            <button
              type="button"
              onClick={() => transportRef.current?.tare()}
              className={`px-3 py-2 rounded-xl text-xs font-bold ${ui.chip} ${ui.muted}`}
            >
              Tare
            </button>
            <button
              type="button"
              onClick={handleDisconnect}
              className={`px-3 py-2 rounded-xl text-xs font-bold ${ui.chip} ${ui.muted}`}
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {status === 'error' && (
        <p className="text-[10px] text-rose-400">Could not connect. Check Bluetooth permissions and try again.</p>
      )}
      {!bleAvailable && transportKind === 'ble' && !simAllowed && (
        <p className={`text-[10px] ${ui.muted}`}>Web Bluetooth is not available in this browser.</p>
      )}
    </div>
  );
}
