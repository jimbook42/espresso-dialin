import { useRef, useState, useCallback, useEffect } from 'react';
import {
  SETTE_GRINDER_ID,
  SUNBEAM_GRINDER_ID,
  NICHE_ZERO_GRINDER_ID,
  adjustSunbeam,
  getGrinderDefinitionById,
  isCustomGrinderModel,
  isSetteGrinderModel,
  isNicheZeroGrinderModel,
} from '../grinders/grinderRegistry.js';
import {
  customDialIndexToValue,
  customDialMaxIndex,
  customDialValueIndex,
  formatCustomGrindDisplay,
  parseCustomGrindValue,
} from '../grinders/customGrinder.js';
import {
  adjustNicheZero,
  formatNicheZeroSetting,
  NICHE_ZERO_DEFAULT_SETTING,
  NICHE_ZERO_DIAL_MAX,
  formatNicheZeroDialRangeLabel,
  getNicheZeroDialLimits,
  parseNicheZeroSetting,
} from '../grinders/nicheZero.js';
import {
  computeTickStripTranslate,
  computeTickWindow,
  VISIBLE_TICKS,
} from './grindControlsTickStrip.js';

const setteUi = getGrinderDefinitionById(SETTE_GRINDER_ID);
const sunbeamUi = getGrinderDefinitionById(SUNBEAM_GRINDER_ID);
const nicheUi = getGrinderDefinitionById(NICHE_ZERO_GRINDER_ID);
const SETTE_MICROS = setteUi.microLetters;
const SETTE_MACRO_MIN = setteUi.macroMin;
const SETTE_MACRO_MAX = setteUi.macroMax;

const SWIPE_THRESHOLD_PX = 14;

const DIAL_CONFIG = {
  macro: {
    valueIndex: (v) => (parseInt(v, 10) || 13) - 1,
    maxValueIndex: SETTE_MACRO_MAX - 1,
  },
  micro: {
    valueIndex: (v) => {
      const idx = SETTE_MICROS.indexOf(v || 'E');
      return idx === -1 ? 4 : idx;
    },
    maxValueIndex: SETTE_MICROS.length - 1,
  },
  sunbeam: {
    valueIndex: (v) => (parseInt(v, 10) || 15) - 1,
    maxValueIndex: 29,
  },
  niche: {
    valueIndex: (v) => {
      const n = parseNicheZeroSetting(v) ?? NICHE_ZERO_DEFAULT_SETTING;
      return Math.round(n * 10);
    },
    maxValueIndex: NICHE_ZERO_DIAL_MAX * 10,
  },
};

function SpinningTickScale({
  valueIndex,
  maxValueIndex,
  dragOffsetPx,
  isDragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}) {
  const viewportRef = useRef(null);
  const [tickSpacing, setTickSpacing] = useState(0);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;

    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setTickSpacing(w / (VISIBLE_TICKS - 1));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clampedIndex = Math.min(Math.max(0, valueIndex), maxValueIndex);
  const { start: windowStart, end: windowEnd } = computeTickWindow(clampedIndex, maxValueIndex);
  const translateX = computeTickStripTranslate(clampedIndex, windowStart, tickSpacing, dragOffsetPx);
  const tickIndices = [];
  for (let i = windowStart; i <= windowEnd; i += 1) tickIndices.push(i);

  return (
    <div
      className="mt-2.5 touch-none cursor-grab active:cursor-grabbing select-none"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      role="slider"
      aria-label="Drag to spin grind dial"
    >
      <div className="py-2 -my-2">
        <div ref={viewportRef} className="relative h-4 w-full overflow-hidden px-0.5">
          {tickSpacing > 0 && (
            <>
              <div
                className="absolute inset-0 bottom-0 top-auto h-4"
                style={{
                  transform: `translateX(${translateX}px)`,
                  transition: isDragging ? 'none' : 'transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)',
                  willChange: 'transform',
                }}
              >
                {tickIndices.map((tickIndex) => (
                  <div
                    key={tickIndex}
                    className="absolute bottom-0 w-px h-2 rounded-full"
                    style={{
                      left: (tickIndex - windowStart) * tickSpacing,
                      backgroundColor: 'var(--tick-strong, #6b6457)',
                    }}
                  />
                ))}
              </div>
              <div
                className="absolute bottom-0 left-1/2 w-0.5 h-3.5 -translate-x-1/2 rounded-full bg-[#e0a660] pointer-events-none z-[1]"
                aria-hidden
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AxisStepper({
  label,
  display,
  onDec,
  onInc,
  ui,
  dialKind,
  valueIndexOverride,
  maxValueIndexOverride,
  canDec = true,
  canInc = true,
}) {
  const config = DIAL_CONFIG[dialKind];
  const dragRef = useRef({ active: false, lastX: 0, acc: 0 });
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const valueIndex = valueIndexOverride ?? config.valueIndex(display);
  const maxValueIndex = maxValueIndexOverride ?? config.maxValueIndex;
  const stepperBtnClass = `${ui.stepperBtn} disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100`;

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
    setIsDragging(false);
    setDragOffsetPx(0);
  }, []);

  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { active: true, lastX: e.clientX, acc: 0 };
    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.lastX;
    dragRef.current.lastX = e.clientX;
    dragRef.current.acc += dx;
    setDragOffsetPx((o) => o - dx);

    while (dragRef.current.acc >= SWIPE_THRESHOLD_PX) {
      if (canInc) onInc();
      dragRef.current.acc -= SWIPE_THRESHOLD_PX;
    }
    while (dragRef.current.acc <= -SWIPE_THRESHOLD_PX) {
      if (canDec) onDec();
      dragRef.current.acc += SWIPE_THRESHOLD_PX;
    }
  };

  return (
    <div className={`${ui.cardInset} rounded-2xl p-3 ring-1 ring-[rgba(200,138,75,0.12)]`}>
      <p className={`text-[9px] uppercase tracking-widest ${ui.muted} mb-2 leading-snug font-semibold`}>{label}</p>
      <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-x-0.5">
        <button
          type="button"
          onClick={onDec}
          disabled={!canDec}
          className={stepperBtnClass}
          aria-label="Decrease"
        >
          −
        </button>
        <span
          className={`min-w-0 px-0.5 text-center text-[clamp(1rem,4.6vw,1.65rem)] leading-none font-black font-mono tabular-nums tracking-tight ${ui.text} drop-shadow-sm`}
        >
          {display}
        </span>
        <button
          type="button"
          onClick={onInc}
          disabled={!canInc}
          className={stepperBtnClass}
          aria-label="Increase"
        >
          +
        </button>
      </div>
      <SpinningTickScale
        valueIndex={valueIndex}
        maxValueIndex={maxValueIndex}
        dragOffsetPx={dragOffsetPx}
        isDragging={isDragging}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}

export function GrinderGrindControls({
  grinderModel,
  settings,
  setteMacro,
  setteMicro,
  sunbeamSetting,
  nicheZeroSetting,
  customGrindValue,
  onSetteMacroChange,
  onSetteMicroChange,
  onSunbeamChange,
  onNicheZeroChange,
  onCustomGrindChange,
  ui,
}) {
  if (isCustomGrinderModel(grinderModel, settings)) {
    const def = getGrinderDefinitionById(grinderModel, settings);
    return (
      <CustomGrindControl
        setting={customGrindValue}
        profile={def.customProfile}
        label={def.dialFieldLabel}
        onChange={onCustomGrindChange}
        ui={ui}
      />
    );
  }
  if (isSetteGrinderModel(grinderModel)) {
    return (
      <SetteGrindControls
        macro={setteMacro}
        micro={setteMicro}
        onMacroChange={onSetteMacroChange}
        onMicroChange={onSetteMicroChange}
        ui={ui}
      />
    );
  }
  if (isNicheZeroGrinderModel(grinderModel)) {
    return (
      <NicheZeroGrindControl
        setting={nicheZeroSetting}
        onChange={onNicheZeroChange}
        settings={settings}
        ui={ui}
      />
    );
  }
  if (!grinderModel || isSetteGrinderModel(grinderModel)) {
    return (
      <SetteGrindControls
        macro={setteMacro}
        micro={setteMicro}
        onMacroChange={onSetteMacroChange}
        onMicroChange={onSetteMicroChange}
        ui={ui}
      />
    );
  }
  return (
    <SunbeamGrindControl
      setting={sunbeamSetting}
      onChange={onSunbeamChange}
      ui={ui}
    />
  );
}

export function NicheZeroGrindControl({ setting, onChange, settings = null, ui }) {
  const { min, max } = getNicheZeroDialLimits(settings);
  const bump = (delta) => {
    onChange(adjustNicheZero(setting, delta, settings));
  };

  const parsed = parseNicheZeroSetting(setting, settings) ?? NICHE_ZERO_DEFAULT_SETTING;
  const display =
    formatNicheZeroSetting(parsed, settings)
    || formatNicheZeroSetting(NICHE_ZERO_DEFAULT_SETTING, settings);
  const nicheTickMax = Math.round((max - min) * 10);
  const nicheTickIndex = Math.round((parsed - min) * 10);

  return (
    <AxisStepper
      label={formatNicheZeroDialRangeLabel(settings)}
      display={display}
      onDec={() => bump(-1)}
      onInc={() => bump(1)}
      canDec={parsed > min}
      canInc={parsed < max}
      ui={ui}
      dialKind="niche"
      valueIndexOverride={nicheTickIndex}
      maxValueIndexOverride={nicheTickMax}
    />
  );
}

export function SetteGrindControls({ macro, micro, onMacroChange, onMicroChange, ui }) {
  const bumpMacro = (delta) => {
    const next = Math.min(SETTE_MACRO_MAX, Math.max(SETTE_MACRO_MIN, (parseInt(macro, 10) || 13) + delta));
    onMacroChange(next);
  };

  const bumpMicro = (delta) => {
    const idx = SETTE_MICROS.indexOf(micro || 'E');
    const base = idx === -1 ? 4 : idx;
    const nextIdx = Math.min(SETTE_MICROS.length - 1, Math.max(0, base + delta));
    onMicroChange(SETTE_MICROS[nextIdx]);
  };

  const macroNum = parseInt(macro, 10) || 13;
  const microIdx = SETTE_MICROS.indexOf(micro || 'E');
  const microBase = microIdx === -1 ? 4 : microIdx;

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3">
      <AxisStepper
        label={setteUi.macroFieldLabel}
        display={macro}
        onDec={() => bumpMacro(-1)}
        onInc={() => bumpMacro(1)}
        canDec={macroNum > SETTE_MACRO_MIN}
        canInc={macroNum < SETTE_MACRO_MAX}
        ui={ui}
        dialKind="macro"
      />
      <AxisStepper
        label={setteUi.microFieldLabel}
        display={micro}
        onDec={() => bumpMicro(-1)}
        onInc={() => bumpMicro(1)}
        canDec={microBase > 0}
        canInc={microBase < SETTE_MICROS.length - 1}
        ui={ui}
        dialKind="micro"
      />
    </div>
  );
}

export function SunbeamGrindControl({ setting, onChange, ui }) {
  const dial = parseInt(setting, 10) || 15;
  const bump = (delta) => {
    onChange(adjustSunbeam(dial, delta));
  };

  return (
    <AxisStepper
      label={sunbeamUi.dialFieldLabel}
      display={setting}
      onDec={() => bump(-1)}
      onInc={() => bump(1)}
      canDec={dial > 1}
      canInc={dial < 30}
      ui={ui}
      dialKind="sunbeam"
    />
  );
}

export function CustomGrindControl({ setting, profile, label, onChange, ui }) {
  const parsed = parseCustomGrindValue(setting, profile);
  const display = formatCustomGrindDisplay(parsed ?? setting, profile);
  const maxIndex = customDialMaxIndex(profile);
  const valueIndex = customDialValueIndex(parsed ?? setting, profile);

  const bump = (delta) => {
    const nextIndex = Math.min(maxIndex, Math.max(0, valueIndex + delta));
    onChange(customDialIndexToValue(nextIndex, profile));
  };

  return (
    <AxisStepper
      label={label}
      display={display}
      onDec={() => bump(-1)}
      onInc={() => bump(1)}
      canDec={valueIndex > 0}
      canInc={valueIndex < maxIndex}
      ui={ui}
      dialKind="macro"
      valueIndexOverride={valueIndex}
      maxValueIndexOverride={maxIndex}
    />
  );
}
