import { useState, useSyncExternalStore } from 'react';
import { useShotLabPressureContext } from './ShotLabPressureContext.jsx';
import { ShotGaugeCamera } from './ShotGaugeCamera.jsx';
import { getScaleLiveWeightSnapshot, resolveShotWeightReadout, subscribeScaleLiveWeight } from '../scales/scaleLiveWeightStore.js';
import { cycleShotMetric, resolveShotScreen, shotEquipment } from '../settings/shotScreenLayout.js';
import { pressureChartPointsForDisplay } from '../flairPressureLab/pressureDisplaySmoothing.js';

const labels = { pressure: 'Pressure', weight: 'Weight', time: 'Time', flow: 'Flow' };
const units = { pressure: 'bar', weight: 'g', time: 's', flow: 'g/s' };
const colours = { pressure: '#c97868', weight: '#f5f2eb', time: '#f5f2eb', flow: '#e0a660' };
const number = (value, places = 1) => value != null && Number.isFinite(value) ? value.toFixed(places) : '—';

function LiveShotChart({ pressure = [], flow = [], gauge, scale }) {
  // Reuse the pressure display's gap semantics. Missing samples remain gaps.
  const bars = gauge ? pressureChartPointsForDisplay(pressure) : [];
  const flows = scale ? flow.filter((p) => Number.isFinite(p.tS) && Number.isFinite(p.flowGs)) : [];
  const end = Math.max(10, ...bars.map((p) => p.tS), ...flows.map((p) => p.tS));
  const flowMax = Math.max(2, ...flows.map((p) => p.flowGs));
  const barMax = Math.max(10, ...bars.map((p) => p.bar));
  const path = (points, key, max) => points.map((p, i) => `${i === 0 || p.breakBefore ? 'M' : 'L'}${(p.tS / end * 300).toFixed(1)},${(55 - p[key] / max * 50).toFixed(1)}`).join(' ');
  return <div data-testid="live-shot-chart" className="rounded-xl border border-[#2e2b26] bg-[#1a1815] px-3 py-2 shrink-0">
    <div className="flex justify-between text-[10px]">
      {gauge && <span className="text-[#c97868]">Pressure · 0–{number(barMax, 0)} bar</span>}
      {scale && <span className="text-[#e0a660]">Flow · 0–{number(flowMax, 1)} g/s</span>}
      <span className="text-[#6b6457]">{number(end, 0)}s</span>
    </div>
    <svg viewBox="0 0 300 60" className="w-full h-14" role="img" aria-label="Live pressure and flow chart">
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
  const primary = options.minimal ? [selectedMetric]
    : equipment.gauge ? ['pressure', options.bigNumber !== 'pressure' ? options.bigNumber : equipment.scale ? 'weight' : 'time']
      : equipment.scale ? [options.bigNumber, options.bigNumber === 'time' ? 'weight' : 'time'] : ['time'];
  const secondary = options.available.filter((metric) => !primary.includes(metric));
  const renderMetric = (metric, big = false) => <div key={metric} data-metric={metric} data-size={big ? 'big' : 'small'}
    className="min-w-0 text-center">
    <div className="text-[10px] uppercase tracking-widest text-[#a09880] mb-1">{labels[metric]}</div>
    <div className={`font-bold tabular-nums leading-none tracking-tight ${big ? primary.length === 1 ? 'text-[clamp(3.5rem,19vw,7rem)]' : 'text-[clamp(2.75rem,13vw,5.5rem)]' : metric === 'pressure' ? 'text-4xl' : 'text-2xl'}`}
      style={{ color: colours[metric] }}>{number(values[metric], metric === 'flow' ? 2 : 1)}<span className="ml-1 text-[0.3em] tracking-normal">{units[metric]}</span></div>
    {metric === 'weight' && targetYieldG > 0 && <>
      <div className="text-xs text-[#a09880] mt-2">/ {targetYieldG} g</div>
      <progress aria-label="Target yield" className="w-full h-1 accent-[#c88a4b]" max={targetYieldG} value={values.weight ?? 0} />
    </>}
    {metric === 'time' && targetTimeS > 0 && <div className="text-xs text-[#a09880] mt-2">Target {targetTimeS}s</div>}
  </div>;
  return <div data-testid="adaptive-shot-screen" data-layout={options.minimal ? 'minimal' : options.layout}
    className={`w-full flex flex-col gap-3 text-[#f5f2eb] ${preview ? 'p-3 bg-[#121110] rounded-xl' : 'flex-1 min-h-0'}`}
    onClick={(event) => event.stopPropagation()}>
    {equipment.gauge && <button type="button" aria-pressed={trust} onClick={() => setTrustOverride(!trust)}
      className="self-end min-h-9 px-3 rounded-lg border border-[#2e2b26] text-xs text-[#c88a4b]">{trust ? 'Hide gauge' : 'Show gauge'}</button>}
    {trust && <ShotGaugeCamera pressure={pressure} expanded onToggle={() => setTrustOverride(false)} barText={number(values.pressure)} preview={preview} />}
    {options.minimal ? <button type="button" aria-label="Cycle big number" onClick={() => setSelected(cycleShotMetric(selectedMetric, options.available))}
      className="py-3 rounded-xl bg-[#1a1815] border border-[#2e2b26]">
      {renderMetric(selectedMetric, true)}<div className="text-[10px] text-[#6b6457] mt-2">Tap number to cycle</div>
    </button> : <div className={`grid ${primary.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-3 py-4 bg-[#1a1815] rounded-xl border border-[#2e2b26]`}>{primary.map((metric) => renderMetric(metric, true))}</div>}
    {secondary.length > 0 && <div className="flex items-center justify-around gap-2">{secondary.map((metric) => renderMetric(metric))}</div>}
    {equipment.gauge && <p className="text-xs text-[#a09880] text-center" role="status">{pressure?.statusText}</p>}
    {equipment.scale && values.weight == null && <p className="text-xs text-[#a09880] text-center">Connect your smart scale for weight and flow.</p>}
    {options.chart && !trust && <LiveShotChart pressure={pressure?.samples} flow={flowSeries} gauge={equipment.gauge} scale={equipment.scale} />}
    {options.cameraPreview && !trust && <ShotGaugeCamera pressure={pressure} expanded={false} onToggle={() => setTrustOverride(true)} preview={preview} />}
  </div>;
}

export function AdaptiveShotScreen({ settings, seconds, targetYieldG, targetTimeS, flowGs, flowSeries,
  scaleEnabled, yieldSettleActive, frozenYieldG }) {
  const pressure = useShotLabPressureContext();
  const snapshot = useSyncExternalStore(subscribeScaleLiveWeight, getScaleLiveWeightSnapshot);
  const weight = resolveShotWeightReadout({ ...snapshot, timerRunning: true, yieldSettleActive, frozenYieldG });
  const equipment = shotEquipment(settings);
  const weightReady = scaleEnabled && snapshot.isConnected && ['shot', 'settling', 'frozen'].includes(weight.mode);
  const statusText = pressure?.readerError || (!pressure?.calibrated ? 'Set up gauge in Settings before using pressure.'
    : pressure.readerUncertain ? 'Pressure uncertain — compare with the gauge.'
      : pressure.hold?.held ? 'Pressure held — waiting for a fresh reading.'
        : pressure.hold?.gap || pressure.displayBar == null ? 'Waiting for a pressure reading…' : pressure.aimText);
  return <ShotScreenView settings={settings} equipment={equipment}
    values={{ pressure: pressure?.enabled ? pressure.displayBar : null, weight: weightReady ? weight.grams : null,
      time: seconds, flow: weightReady ? flowGs : null }}
    pressure={{ ...pressure, statusText }} flowSeries={weightReady ? flowSeries : []}
    targetYieldG={targetYieldG} targetTimeS={targetTimeS} />;
}
