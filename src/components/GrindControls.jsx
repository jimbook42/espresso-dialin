import { useRef, useState, useEffect, useCallback } from 'react';
import { adjustSunbeam } from '../utils/grinderLogic';

const SETTE_MICROS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

const SWIPE_THRESHOLD_PX = 12;
const SPIN_DEG_PER_STEP = 18;
const MAX_SPIN_DEG = 54;

function stepDelta(prev, next, dialKind) {
  if (dialKind === 'micro') {
    const a = SETTE_MICROS.indexOf(prev ?? 'E');
    const b = SETTE_MICROS.indexOf(next ?? 'E');
    const from = a === -1 ? 4 : a;
    const to = b === -1 ? 4 : b;
    return to - from;
  }
  const from = parseInt(prev, 10) || 0;
  const to = parseInt(next, 10) || 0;
  return to - from;
}

function SpinningTickScale({ rotationDeg, isDragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }) {
  const ticks = Array.from({ length: 9 }, (_, i) => i);
  return (
    <div
      className="mt-2.5 touch-none cursor-grab active:cursor-grabbing select-none"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      role="slider"
      aria-label="Drag to adjust grind"
    >
      <div className="py-2 -my-2">
      <div
        className="flex justify-between items-end px-0.5 h-4"
        style={{
          transform: `rotate(${rotationDeg}deg)`,
          transformOrigin: '50% 220%',
          transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.34, 1.1, 0.64, 1)',
        }}
      >
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
      </div>
    </div>
  );
}

function AxisStepper({ label, display, onDec, onInc, ui, dialKind }) {
  const dragRef = useRef({ active: false, lastX: 0, acc: 0 });
  const prevDisplayRef = useRef(display);
  const [dragRotation, setDragRotation] = useState(0);
  const [kickRotation, setKickRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const totalRotation = kickRotation + dragRotation;

  useEffect(() => {
    const prev = prevDisplayRef.current;
    if (prev === display) return;

    const delta = stepDelta(prev, display, dialKind);
    prevDisplayRef.current = display;

    if (delta === 0) return;

    const steps = Math.min(Math.abs(delta), 3);
    const deg = Math.sign(delta) * steps * SPIN_DEG_PER_STEP;
    const clamped = Math.max(-MAX_SPIN_DEG, Math.min(MAX_SPIN_DEG, deg));

    setKickRotation(clamped);
    const timer = window.setTimeout(() => setKickRotation(0), 40);
    return () => window.clearTimeout(timer);
  }, [display, dialKind]);

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
    setIsDragging(false);
    setDragRotation(0);
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
    setDragRotation((r) => {
      const next = r + dx * 0.35;
      return Math.max(-MAX_SPIN_DEG, Math.min(MAX_SPIN_DEG, next));
    });

    while (dragRef.current.acc >= SWIPE_THRESHOLD_PX) {
      onInc();
      dragRef.current.acc -= SWIPE_THRESHOLD_PX;
      setDragRotation(0);
    }
    while (dragRef.current.acc <= -SWIPE_THRESHOLD_PX) {
      onDec();
      dragRef.current.acc += SWIPE_THRESHOLD_PX;
      setDragRotation(0);
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
        rotationDeg={totalRotation}
        isDragging={isDragging}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
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
        dialKind="macro"
      />
      <AxisStepper
        label="Micro A–I"
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
      label="Dial setting 1–30"
      display={setting}
      onDec={() => bump(-1)}
      onInc={() => bump(1)}
      ui={ui}
      dialKind="sunbeam"
    />
  );
}
