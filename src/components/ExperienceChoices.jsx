import { EXPERIENCES } from '../settings/experiencePreference.js';

export function ExperienceChoices({ value, onChange, ui, legend, disabled = false }) {
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className={`mb-2 text-base font-bold ${ui.text}`}>{legend}</legend>
      {EXPERIENCES.map(({ id, label, description }) => (
        <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${ui.input} ${value === id ? 'border-[#c88a4b]' : ''}`}>
          <input
            type="radio"
            name="experience-preference"
            value={id}
            checked={value === id}
            onChange={() => onChange(id)}
            aria-labelledby={`experience-label-${id}`}
            aria-describedby={`experience-description-${id}`}
            className="mt-0.5 size-4 shrink-0 accent-[#c88a4b]"
          />
          <span>
            <span id={`experience-label-${id}`} className={`block text-sm font-bold ${ui.text}`}>{label}</span>
            <span id={`experience-description-${id}`} className={`block text-xs leading-relaxed ${ui.sub}`}>{description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
