import { SHOT_METRICS, recommendedShotScreen, resolveShotScreen, shotEquipment, shotEquipmentPatch } from '../settings/shotScreenLayout.js';
import { ShotScreenView } from './AdaptiveShotScreen.jsx';

export function ShotScreenCustomizer({ settings, onPatch }) {
  const equipment = shotEquipment(settings);
  const options = resolveShotScreen(settings);
  const change = (patch) => onPatch({ shotScreen: { ...settings?.shotScreen, ...patch } });
  return <section className="space-y-3 rounded-xl border border-[#2e2b26] p-3 bg-[#121110] text-[#f5f2eb]" aria-label="Shot screen customiser">
    <h4 className="font-bold text-sm">Shot screen</h4>
    <fieldset className="space-y-2"><legend className="mb-2 text-[#a09880]">What do you have?</legend>
      {['scale', 'gauge', 'timer'].map((item) => <label key={item} className="flex items-center gap-2 min-h-8">
        <input type="checkbox" checked={item === 'timer' ? !equipment.scale && !equipment.gauge : equipment[item]}
          onChange={(event) => onPatch(shotEquipmentPatch(item === 'timer'
            ? { gauge: false, scale: false } : { ...equipment, [item]: event.target.checked }))} />
        {{ scale: 'Smart scale', gauge: 'Pressure gauge via camera', timer: 'Timer only' }[item]}
      </label>)}
    </fieldset>
    <p className="text-[10px] text-[#a09880]">Choose your scale model below to connect. Gauge setup uses the existing camera calibration.</p>
    <label className="block text-[#a09880]">Choose big number
      <select aria-label="Choose big number" value={options.bigNumber} onChange={(e) => change({ bigNumber: e.target.value })}
        className="mt-1 w-full rounded-lg bg-[#1a1815] border border-[#2e2b26] p-2 text-[#f5f2eb]">
        {SHOT_METRICS.map((metric) => <option key={metric} value={metric} disabled={!options.available.includes(metric)}>
          {metric[0].toUpperCase() + metric.slice(1)}{options.available.includes(metric) ? '' : metric === 'pressure' ? ' — select pressure gauge' : ' — select smart scale'}
        </option>)}
      </select>
    </label>
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      {[[ 'chart', 'Chart' ], [ 'cameraPreview', 'Camera preview' ], [ 'minimal', 'Minimal mode' ], [ 'showGauge', 'Show gauge' ]].map(([key, label]) => <label key={key} className="flex items-center gap-2 min-h-8 text-xs">
        <input type="checkbox" checked={Boolean(options[key])} disabled={(key === 'cameraPreview' || key === 'showGauge') ? !equipment.gauge : key === 'chart' && !equipment.gauge && !equipment.scale}
          onChange={(e) => change({ [key]: e.target.checked })} />{label}
      </label>)}
    </div>
    <button type="button" className="w-full min-h-10 rounded-lg bg-[#c88a4b] text-[#121110] font-bold"
      onClick={() => change(recommendedShotScreen(equipment))}>Recommended for my setup</button>
    <p className="text-[10px] uppercase tracking-wider text-[#a09880]">Live preview · example values</p>
    <div className="max-h-80 overflow-auto border border-[#2e2b26] rounded-xl" data-testid="shot-screen-preview">
      <ShotScreenView key={JSON.stringify(options)} settings={settings} preview
        values={{ pressure: 8.4, weight: 24.6, time: 21.3, flow: 1.8 }} targetYieldG={36} targetTimeS={30} />
    </div>
  </section>;
}
