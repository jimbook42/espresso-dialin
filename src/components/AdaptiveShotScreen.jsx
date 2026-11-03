import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SwitchCamera } from 'lucide-react';
import { useShotLabPressureContext } from './ShotLabPressureContext.jsx';
import { ShotGaugeCamera } from './ShotGaugeCamera.jsx';
import { getScaleLiveWeightSnapshot, resolveShotWeightReadout, subscribeScaleLiveWeight } from '../scales/scaleLiveWeightStore.js';
import { cycleShotMetric, resolveShotScreen, shotEquipment } from '../settings/shotScreenLayout.js';
import { pressureChartPointsForDisplay } from '../flairPressureLab/pressureDisplaySmoothing.js';
import './shotScreenLayout.css';

const labels = { pressure: 'Pressure', weight: 'Weight', time: 'Time', flow: 'Flow' };
const units = { pressure: 'bar', weight: 'g', time: 's', flow: 'g/s' };
const colours = { pressure: '#c97868', weight: '#f5f2eb', time: '#f5f2eb', flow: '#e0a660' };
const number = (value, places = 1) => value != null && Number.isFinite(value) ? value.toFixed(places) : '—';

function LiveShotChart({ pressure = [], flow = [], gauge, scale, grow = false }) {
  // Reuse the pressure display's gap semantics. Missing samples remain gaps.
  const bars = gauge ? pressureChartPointsForDisplay(pressure) : [];
  const flows = scale ? flow.filter((p) => Number.isFinite(p.tS) && Number.isFinite(p.flowGs)) : [];
  const end = Math.max(10, ...bars.map((p) => p.tS), ...flows.map((p) => p.tS));
  const flowMax = Math.max(2, ...flows.map((p) => p.flowGs));
  const barMax = Math.max(10, ...bars.map((p) => p.bar));
  const path = (points, key, max) => points.map((p, i) => `${i === 0 || p.breakBefore ? 'M' : 'L'}${(p.tS / end * 300).toFixed(1)},${(55 - p[key] / max * 50).toFixed(1)}`).join(' ');
  return <div data-testid="live-shot-chart" className={`shot-live-chart ${grow ? 'shot-live-chart--grow' : ''} rounded-xl border border-[#2e2b26] bg-[#1a1815] px-3 py-2`}>
    <div className="shot-chart-axis-labels flex justify-between text-[10px]">
      {gauge && <span className="text-[#c97868]">Pressure · 0–{number(barMax, 0)} bar</span>}
      {scale && <span className="text-[#e0a660]">Flow · 0–{number(flowMax, 1)} g/s</span>}
      <span className="text-[#6b6457]">{number(end, 0)}s</span>
    </div>
    <svg viewBox="0 0 300 60" preserveAspectRatio="none" className="w-full" role="img" aria-label="Live pressure and flow chart">
      <path d="M0,55 H300" stroke="#2e2b26" />
      <path d={path(bars, 'bar', barMax)} stroke="#c97868" fill="none" strokeWidth="2" />
      <path d={path(flows, 'flowGs', flowMax)} stroke="#e0a660" fill="none" strokeWidth="2" />
    </svg>
  </div>;
}

export function ShotScreenView({ settings, equipment = shotEquipment(settings), values, pressure,
  flowSeries = [], targetYieldG, targetTimeS, preview = false }) {
  const options = resolveShotScreen(settings, equipment);
  const [selected, setSelected] = useState(null);
  const [trustOverride, setTrustOverride] = useState(null);
  const selectedMetric = options.available.includes(selected) ? selected : options.bigNumber;
  const trust = equipment.gauge && (trustOverride ?? options.showGauge);
  // Minimal remains interactive in the customiser, even with the gauge shown.
  const portraitTrust = trust && !(preview && options.minimal);
  const screenRef = useRef(null);
  useLayoutEffect(() => {
    if (preview) return undefined;
    const host = screenRef.current?.closest('.fixed');
    if (!host || !Array.from(host.children).some((child) => child.classList.contains('shot-timer-header'))) return undefined;
    host.classList.toggle('shot-portrait-fullscreen', trust);
    return () => host.classList.remove('shot-portrait-fullscreen');
  }, [trust, preview]);
  const pressureText = Number.isFinite(values.pressure) ? number(values.pressure) : '--';
  const [cameraMounted, setCameraMounted] = useState(trust);
  useEffect(() => {
    if (trust) {
      setCameraMounted(true);
      return undefined;
    }
    if (!cameraMounted) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      setCameraMounted(false);
      return undefined;
    }
    const timer = setTimeout(() => setCameraMounted(false), 200);
    return () => clearTimeout(timer);
  }, [trust, cameraMounted]);
  const primary = options.minimal ? [selectedMetric]
    : equipment.gauge ? ['pressure', options.bigNumber !== 'pressure' ? options.bigNumber : equipment.scale ? 'weight' : 'time']
      : equipment.scale ? [options.bigNumber, options.bigNumber === 'time' ? 'weight' : 'time'] : ['time'];
  const secondary = options.available.filter((metric) => !primary.includes(metric));
  const renderMetric = (metric, big = false) => <div key={metric} data-metric={metric} data-size={big ? 'big' : 'small'}
    className={`shot-metric ${big ? 'shot-metric--big' : ''} min-w-0 text-center`}>
    <div className="text-[10px] uppercase tracking-widest text-[#a09880] mb-1">{labels[metric]}</div>
    <div className={`shot-metric-value font-bold tabular-nums leading-none tracking-tight ${big ? '' : metric === 'pressure' ? 'text-4xl' : 'text-2xl'}`}
      style={{ color: colours[metric] }}>{metric === 'pressure' ? pressureText : number(values[metric], metric === 'flow' ? 2 : 1)}<span className="ml-1 text-[0.3em] tracking-normal">{units[metric]}</span></div>
    {metric === 'weight' && targetYieldG > 0 && <>
      <div className="text-xs text-[#a09880] mt-2">/ {targetYieldG} g</div>
      <progress aria-label="Target yield" className="w-full h-1 accent-[#c88a4b]" max={targetYieldG} value={values.weight ?? 0} />
    </>}
    {metric === 'time' && (targetTimeS > 0 || options.layout === 'gauge') && <div className="shot-time-sublabel text-xs text-[#a09880] mt-2">{targetTimeS > 0 ? `Target ${targetTimeS}s` : '\u00a0'}</div>}
  </div>;
  const edgeMetrics = ['time', ...(equipment.scale ? ['weight', 'flow'] : [])].map((metric) =>
    <span key={metric} data-edge-metric={metric} className="shot-camera-edge-metric">
      <span className="shot-camera-edge-label">{labels[metric]}</span>
      <span className="shot-camera-edge-value" style={{ color: colours[metric] }}>{number(values[metric], metric === 'flow' ? 2 : 1)}<small> {units[metric]}</small></span>
    </span>);
  return <div ref={screenRef} data-testid="adaptive-shot-screen" data-layout={options.minimal ? 'minimal' : options.layout}
    className={`shot-screen shot-screen--${options.minimal ? 'minimal' : options.layout} ${trust ? 'shot-screen--trust' : ''} ${portraitTrust ? 'shot-screen--portrait' : ''} ${preview ? 'shot-screen--preview' : ''} w-full flex-1 text-[#f5f2eb]`}
    onClick={(event) => event.stopPropagation()}>
    {equipment.gauge && <div className="shot-camera-toolbar self-end flex items-center gap-2">
      <button type="button" aria-pressed={trust} onClick={() => setTrustOverride(!trust)}
        className="shot-gauge-toggle min-h-9 px-3 rounded-lg border border-[#2e2b26] text-xs text-[#c88a4b]">{trust ? 'Hide gauge' : 'Show gauge'}</button>
      {trust && <button type="button" className="shot-camera-flip" onClick={pressure?.flipCamera} disabled={!pressure?.flipCamera}
        aria-label={pressure?.facingMode === 'environment' ? 'Switch to front camera' : 'Switch to rear camera'}
        title={pressure?.facingMode === 'environment' ? 'Switch to front camera' : 'Switch to rear camera'}>
        <SwitchCamera size={20} aria-hidden="true" />
      </button>}
    </div>}
    {options.minimal ? <button type="button" aria-label="Cycle big number" onClick={() => setSelected(cycleShotMetric(selectedMetric, options.available))}
      className="shot-minimal-center">
      {renderMetric(selectedMetric, true)}<div className="text-[10px] text-[#6b6457] mt-2">Tap number to cycle</div>
    </button> : <div className={`shot-hero grid ${primary.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-3 py-4 bg-[#1a1815] rounded-xl border border-[#2e2b26]`}>{primary.map((metric) => renderMetric(metric, true))}</div>}
    <div className="shot-screen-support">
    {secondary.length > 0 && <div className="flex items-center justify-around gap-2">{secondary.map((metric) => renderMetric(metric))}</div>}
    {equipment.gauge && <p className="text-xs text-[#a09880] text-center" role="status" data-testid={pressure?.noPressureReadingWarning ? 'no-pressure-reading-warning' : undefined}>{pressure?.statusText}</p>}
    {equipment.scale && values.weight == null && <p className="text-xs text-[#a09880] text-center">Connect your smart scale for weight and flow.</p>}
    </div>
    {(trust || cameraMounted) && <div className={`shot-trust-camera ${trust ? 'shot-trust-camera--open' : ''}`} aria-hidden={!trust} inert={!trust}>
      <div className="shot-trust-camera-inner"><ShotGaugeCamera pressure={pressure} expanded active={trust} onToggle={() => setTrustOverride(false)} barText={pressureText} preview={preview} edgeMetrics={edgeMetrics} /></div>
    </div>}
    {options.chart && !options.minimal && <LiveShotChart pressure={pressure?.samples} flow={flowSeries} gauge={equipment.gauge} scale={equipment.scale} grow={options.layout === 'scale'} />}
  </div>;
}

export function AdaptiveShotScreen({ settings, seconds, targetYieldG, targetTimeS, flowGs, flowSeries,
  scaleEnabled, yieldSettleActive, frozenYieldG }) {
  const pressure = useShotLabPressureContext();
  const snapshot = useSyncExternalStore(subscribeScaleLiveWeight, getScaleLiveWeightSnapshot);
  const weight = resolveShotWeightReadout({ ...snapshot, timerRunning: true, yieldSettleActive, frozenYieldG });
  const equipment = shotEquipment(settings);
  const weightReady = scaleEnabled && snapshot.isConnected && ['shot', 'settling', 'frozen'].includes(weight.mode);
  const statusText = pressure?.noPressureReadingWarning
    || pressure?.readerError
    || (!pressure?.calibrated ? 'Set up gauge in Settings before using pressure.'
      : pressure.readerUncertain ? 'Pressure uncertain — compare with the gauge.'
        : pressure.hold?.held ? 'Pressure held — waiting for a fresh reading.'
          : pressure.hold?.gap || pressure.displayBar == null ? 'Waiting for a pressure reading…' : pressure.aimText);
  return <ShotScreenView settings={settings} equipment={equipment}
    values={{ pressure: pressure?.enabled ? pressure.displayBar : null, weight: weightReady ? weight.grams : null,
      time: seconds, flow: weightReady ? flowGs : null }}
    pressure={{ ...pressure, statusText }} flowSeries={weightReady ? flowSeries : []}
    targetYieldG={targetYieldG} targetTimeS={targetTimeS} />;
}
