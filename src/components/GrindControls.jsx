import { useRef, useState, useCallback, useEffect } from 'react';
import {
  SETTE_GRINDER_ID,
  SUNBEAM_GRINDER_ID,
  adjustSunbeam,
  getGrinderDefinitionById,
  isSetteGrinderModel,
} from '../grinders/grinderRegistry.js';

const setteUi = getGrinderDefinitionById(SETTE_GRINDER_ID);
const sunbeamUi = getGrinderDefinitionById(SUNBEAM_GRINDER_ID);
const SETTE_MICROS = setteUi.microLetters;
const SETTE_MACRO_MIN = setteUi.macroMin;
const SETTE_MACRO_MAX = setteUi.macroMax;

const SWIPE_THRESHOLD_PX = 14;
const VISIBLE_TICKS = 9;
const CENTER_TICK = 4;

const DIAL_CONFIG = {
  macro: { valueIndex: (v) => (parseInt(v, 10) || 13) - 1 },
  micro: {
    valueIndex: (v) => {
      const idx = SETTE_MICROS.indexOf(v || 'E');
      return idx === -1 ? 4 : idx;
    },
  },
  sunbeam: { valueIndex: (v) => (parseInt(v, 10) || 15) - 1 },
};

function SpinningTickScale({
  valueIndex,
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

  const translateX = tickSpacing > 0 ? CENTER_TICK * tickSpacing - (CENTER_TICK + valueIndex) * tickSpacing + dragOffsetPx : 0;

  const stripLength = 120;

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
                {Array.from({ length: stripLength }, (_, i) => (
                  <div
                    key={i}
                    className="absolute bottom-0 w-px h-2 rounded-full"
                    style={{
                      left: i * tickSpacing,
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

function AxisStepper({ label, display, onDec, onInc, ui, dialKind }) {
  const config = DIAL_CONFIG[dialKind];
  const dragRef = useRef({ active: false, lastX: 0, acc: 0 });
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const valueIndex = config.valueIndex(display);

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
      onInc();
      dragRef.current.acc -= SWIPE_THRESHOLD_PX;
    }
    while (dragRef.current.acc <= -SWIPE_THRESHOLD_PX) {
      onDec();
      dragRef.current.acc += SWIPE_THRESHOLD_PX;
    }
  };

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
      <SpinningTickScale
        valueIndex={valueIndex}
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
  setteMacro,
  setteMicro,
  sunbeamSetting,
  onSetteMacroChange,
  onSetteMicroChange,
  onSunbeamChange,
  ui,
}) {
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
  return (
    <SunbeamGrindControl
      setting={sunbeamSetting}
      onChange={onSunbeamChange}
      ui={ui}
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

  return (
    <div className="grid grid-cols-2 gap-3">
      <AxisStepper
        label={setteUi.macroFieldLabel}
        display={macro}
        onDec={() => bumpMacro(-1)}
        onInc={() => bumpMacro(1)}
        ui={ui}
        dialKind="macro"
      />
      <AxisStepper
        label={setteUi.microFieldLabel}
        display={micro}
        onDec={() => bumpMicro(-1)}
        onInc={() => bumpMicro(1)}
        ui={ui}
        dialKind="micro"
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
      label={sunbeamUi.dialFieldLabel}
      display={setting}
      onDec={() => bump(-1)}
      onInc={() => bump(1)}
      ui={ui}
      dialKind="sunbeam"
    />
  );
}
