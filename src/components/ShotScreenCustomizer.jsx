import { SHOT_METRICS, recommendedShotScreen, resolveShotScreen, shotEquipment, shotEquipmentPatch } from '../settings/shotScreenLayout.js';
import { getAppTheme } from '../theme.js';
import { ShotScreenPreview } from './ShotScreenPreview.jsx';
import { SettingsToggle } from './SettingsToggle.jsx';

const defaultTheme = getAppTheme(true);

function ToggleRow({ title, description, checked, onChange, disabled, ui, divider = false }) {
  return <div className={`${divider ? `border-t ${ui.modalDivider} pt-3 ` : ''}flex items-center justify-between gap-3`}>
    <div>
      <span className={`font-bold block ${ui.text}`}>{title}</span>
      <span className={`text-[10px] ${ui.muted}`}>{description}</span>
    </div>
    <SettingsToggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
  </div>;
}

export function ShotScreenCustomizer({ settings, onPatch, ui = defaultTheme }) {
  const equipment = shotEquipment(settings);
  const options = resolveShotScreen(settings);
  const change = (patch) => onPatch({ shotScreen: { ...settings?.shotScreen, ...patch } });
  return <section className="space-y-3" aria-label="Shot screen customiser">
    <h4 className={ui.sectionTitle}>Shot screen</h4>
    <div className={`${ui.cardInset} rounded-xl p-3 space-y-3`}>
      <h5 className={ui.fieldLabel}>What do you have?</h5>
      {[
        ['scale', 'Smart scale', 'Choose your scale model below to connect for weight and flow.'],
        ['gauge', 'Pressure gauge via camera', 'Read pressure using your existing gauge camera setup.'],
        ['timer', 'Timer only', 'Use the timer with no equipment connected.'],
      ].map(([item, title, description], index) => <ToggleRow key={item} title={title} description={description}
        checked={item === 'timer' ? !equipment.scale && !equipment.gauge : equipment[item]}
        onChange={(checked) => onPatch(shotEquipmentPatch(item === 'timer'
          ? { gauge: false, scale: false } : { ...equipment, [item]: checked }))}
        ui={ui} divider={index > 0} />)}
    </div>
    <div className={`${ui.cardInset} rounded-xl p-3 space-y-3`}>
      <div className="space-y-2">
        <label htmlFor="shot-screen-big-number" className={`block ${ui.fieldLabel}`}>Choose big number</label>
        <select id="shot-screen-big-number" aria-label="Choose big number" value={options.bigNumber} onChange={(e) => change({ bigNumber: e.target.value })}
          className={`w-full ${ui.input} border rounded-lg p-2.5 font-semibold text-xs`}>
          {SHOT_METRICS.map((metric) => <option key={metric} value={metric} disabled={!options.available.includes(metric)}>
            {metric[0].toUpperCase() + metric.slice(1)}{options.available.includes(metric) ? '' : metric === 'pressure' ? ' — select pressure gauge' : ' — select smart scale'}
          </option>)}
        </select>
      </div>
      {[
        ['chart', 'Chart', 'Show a live chart of the available pressure and flow readings.'],
        ['cameraPreview', 'Camera preview', 'Keep a small gauge camera preview on the shot screen.'],
        ['minimal', 'Minimal mode', 'Show one huge number; tap it to cycle through your metrics.'],
        ['showGauge', 'Show gauge', 'Give the gauge camera a large view with pressure and needle overlay.'],
      ].map(([key, title, description]) => {
        const disabled = key === 'cameraPreview' || key === 'showGauge'
          ? !equipment.gauge : key === 'chart' && !equipment.gauge && !equipment.scale;
        return <ToggleRow key={key} title={title}
          description={disabled ? key === 'chart' ? 'Select a smart scale or pressure gauge to show a chart.' : 'Select a pressure gauge to use the camera.' : description}
          checked={Boolean(options[key])} disabled={disabled} onChange={(checked) => change({ [key]: checked })}
          ui={ui} divider />;
      })}
      <button type="button" className={`w-full rounded-lg p-2.5 text-xs ${ui.primary}`}
        onClick={() => change(recommendedShotScreen(equipment))}>Recommended for my setup</button>
    </div>
    <div className={`${ui.cardInset} rounded-xl p-3 space-y-3`}>
      <h5 className={ui.fieldLabel}>Live preview · example values</h5>
      <div className={`${ui.inset} rounded-xl`}>
        <ShotScreenPreview settings={settings} onGaugeVisibilityChange={(showGauge) => change({ showGauge })} />
      </div>
    </div>
  </section>;
}
