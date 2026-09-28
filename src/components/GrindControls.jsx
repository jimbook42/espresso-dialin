import { adjustSunbeam } from '../utils/grinderLogic';

const SETTE_MICROS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

function TickScale() {
  const ticks = Array.from({ length: 9 }, (_, i) => i);
  return (
    <div className="flex justify-between items-end px-0.5 mt-2.5 h-4">
      {ticks.map((i) => {
        const isCenter = i === 4;
        return (
          <div
            key={i}
            className={`rounded-full ${isCenter ? 'w-0.5 h-3.5 bg-[#e0a660]' : 'w-px h-2'}`}
            style={!isCenter ? { backgroundColor: 'var(--tick-strong, #6b6457)' } : undefined}
          />
        );
      })}
    </div>
  );
}

function AxisStepper({ label, display, onDec, onInc, ui }) {
  return (
    <div className={`${ui.cardInset} rounded-2xl p-3 ring-1 ring-[rgba(200,138,75,0.12)]`}>
      <p className={`text-[9px] uppercase tracking-widest ${ui.muted} mb-2 leading-snug font-semibold`}>{label}</p>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onDec} className={ui.stepperBtn} aria-label="Decrease">
          −
        </button>
        <span className={`text-3xl font-black font-mono tabular-nums ${ui.text} drop-shadow-sm`}>{display}</span>
        <button type="button" onClick={onInc} className={ui.stepperBtn} aria-label="Increase">
          +
        </button>
      </div>
      <TickScale />
    </div>
  );
}

export function SetteGrindControls({ macro, micro, onMacroChange, onMicroChange, ui }) {
  const bumpMacro = (delta) => {
    const next = Math.min(31, Math.max(1, (parseInt(macro, 10) || 13) + delta));
    onMacroChange(next);
  };

  const bumpMicro = (delta) => {
    const idx = SETTE_MICROS.indexOf(micro || 'E');
    const base = idx === -1 ? 4 : idx;
    const nextIdx = Math.min(SETTE_MICROS.length - 1, Math.max(0, base + delta));
    onMicroChange(SETTE_MICROS[nextIdx]);
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <AxisStepper
        label="Macro 1–31"
        display={macro}
        onDec={() => bumpMacro(-1)}
        onInc={() => bumpMacro(1)}
        ui={ui}
      />
      <AxisStepper
        label="Micro A–I"
        display={micro}
        onDec={() => bumpMicro(-1)}
        onInc={() => bumpMicro(1)}
        ui={ui}
      />
    </div>
  );
}

export function SunbeamGrindControl({ setting, onChange, ui }) {
  const bump = (delta) => {
    const next = adjustSunbeam(parseInt(setting, 10) || 15, delta);
    onChange(next);
  };

  return (
    <AxisStepper
      label="Dial setting 1–30"
      display={setting}
      onDec={() => bump(-1)}
      onInc={() => bump(1)}
      ui={ui}
    />
  );
}
