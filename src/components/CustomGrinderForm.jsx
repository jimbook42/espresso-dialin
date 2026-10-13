import { isCustomGrinderFormValid, normalizeCustomGrinderProfile } from '../grinders/customGrinder.js';

const inputClass =
  'w-full bg-[#211e1a] border border-[#2e2b26] text-[#f5f2eb] rounded-lg p-2.5 text-sm font-semibold';

/**
 * @param {{ value: object, onChange: (next: object) => void, ui?: object }} props
 */
export function CustomGrinderForm({ value, onChange, ui }) {
  const labelClass = ui?.fieldLabel || 'text-[10px] uppercase tracking-widest text-[#6b6457] font-bold';
  const muted = ui?.muted || 'text-[#6b6457]';
  const v = value || {
    name: '',
    dialType: 'stepped',
    min: 1,
    max: 40,
    step: 1,
    lowerIsFiner: true,
  };

  const patch = (partial) => onChange({ ...v, ...partial });

  const validation = normalizeCustomGrinderProfile(v);
  const invalid = v.name.trim() && !validation;

  return (
    <div className="space-y-3">
      <div>
        <label className={`block ${labelClass} mb-1`}>Grinder name</label>
        <input
          type="text"
          value={v.name}
          onChange={(e) => patch({ name: e.target.value })}
          className={inputClass}
          placeholder="e.g. DF64"
        />
      </div>
      <div>
        <label className={`block ${labelClass} mb-1`}>Dial type</label>
        <select
          value={v.dialType}
          onChange={(e) => patch({ dialType: e.target.value })}
          className={inputClass}
        >
          <option value="stepped">Stepped</option>
          <option value="stepless">Stepless</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={`block ${labelClass} mb-1`}>Min</label>
          <input
            type="number"
            value={v.min}
            onChange={(e) => patch({ min: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={`block ${labelClass} mb-1`}>Max</label>
          <input
            type="number"
            value={v.max}
            onChange={(e) => patch({ max: e.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={`block ${labelClass} mb-1`}>Step</label>
          <input
            type="number"
            step="any"
            value={v.step}
            onChange={(e) => patch({ step: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>
      <p className={`text-[10px] ${muted}`}>
        {v.dialType === 'stepless'
          ? 'Stepless: step is the smallest change on the dial (e.g. 0.1 or 1).'
          : 'Stepped: whole-number steps between min and max.'}
      </p>
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-bold text-[#f5f2eb]">Lower number is finer</span>
          <p className={`text-[10px] ${muted}`}>Turn off if your grinder counts up toward finer.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={v.lowerIsFiner}
          onClick={() => patch({ lowerIsFiner: !v.lowerIsFiner })}
          className={`w-12 h-7 rounded-full transition-colors ${v.lowerIsFiner ? 'bg-[#c88a4b]' : 'bg-[#2e2b26]'}`}
        >
          <span
            className={`block w-5 h-5 mt-1 rounded-full bg-[#f5f2eb] transition-transform ${v.lowerIsFiner ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>
      {invalid && (
        <p className="text-[11px] text-[#c97868]">Check name, min/max, and step — max must be above min.</p>
      )}
    </div>
  );
}
