import { useRef, useState, useCallback } from 'react';
import { adjustSunbeam } from '../utils/grinderLogic';

const SETTE_MICROS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];

const SWIPE_THRESHOLD_PX = 14;
const DEG_PER_MACRO = 360 / 31;
const DEG_PER_MICRO = 360 / 9;
const DEG_PER_SUNBEAM = 360 / 30;

function valueToRotation(display, dialKind) {
  if (dialKind === 'macro') {
    return ((parseInt(display, 10) || 13) - 1) * DEG_PER_MACRO;
  }
  if (dialKind === 'micro') {
    const idx = SETTE_MICROS.indexOf(display || 'E');
    return (idx === -1 ? 4 : idx) * DEG_PER_MICRO;
  }
  if (dialKind === 'sunbeam') {
    return ((parseInt(display, 10) || 15) - 1) * DEG_PER_SUNBEAM;
  }
  return 0;
}

function GrinderDialFace({ rotationDeg, isDragging }) {
  const ticks = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div
      className="absolute inset-0 flex items-center justify-center pointer-events-none"
      style={{
        transform: `rotate(${rotationDeg}deg)`,
        transition: isDragging ? 'none' : 'transform 0.32s cubic-bezier(0.34, 1.1, 0.64, 1)',
      }}
      aria-hidden
    >
      <div
        className="relative w-[4.25rem] h-[4.25rem] rounded-full border-2 shadow-inner"
        style={{
          borderColor: 'rgba(200, 138, 75, 0.45)',
          background: 'linear-gradient(145deg, var(--dial-face-top, #2a2722) 0%, var(--dial-face-bot, #1a1816) 100%)',
          boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04)',
        }}
      >
        {ticks.map((i) => {
          const major = i % 6 === 0;
          return (
            <div
              key={i}
              className="absolute left-1/2 top-1.5 -ml-px origin-bottom"
              style={{
                height: major ? '0.55rem' : '0.3rem',
                width: major ? '2px' : '1px',
                transform: `rotate(${i * 15}deg)`,
                transformOrigin: '50% 1.625rem',
                backgroundColor: major ? '#e0a660' : 'var(--tick-strong, #6b6457)',
                borderRadius: '1px',
              }}
            />
          );
        })}
        <div
          className="absolute left-1/2 top-[18%] w-1 h-2 -ml-0.5 rounded-sm bg-[#e0a660]"
          style={{ boxShadow: '0 0 4px rgba(224, 166, 96, 0.5)' }}
        />
      </div>
    </div>
  );
}

function AxisStepper({ label, display, onDec, onInc, ui, dialKind }) {
  const dragRef = useRef({ active: false, lastY: 0, acc: 0 });
  const [dragRotation, setDragRotation] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const baseRotation = valueToRotation(display, dialKind);
  const totalRotation = baseRotation + dragRotation;

  const endDrag = useCallback(() => {
    dragRef.current.active = false;
    setIsDragging(false);
    setDragRotation(0);
  }, []);

  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { active: true, lastY: e.clientY, acc: 0 };
    setIsDragging(true);
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;
    const dy = e.clientY - dragRef.current.lastY;
    dragRef.current.lastY = e.clientY;
    dragRef.current.acc += dy;
    setDragRotation((prev) => prev - dy * 1.15);

    while (dragRef.current.acc <= -SWIPE_THRESHOLD_PX) {
      onInc();
      dragRef.current.acc += SWIPE_THRESHOLD_PX;
    }
    while (dragRef.current.acc >= SWIPE_THRESHOLD_PX) {
      onDec();
      dragRef.current.acc -= SWIPE_THRESHOLD_PX;
    }
  };

  const handlePointerUp = () => {
    endDrag();
  };

  const handlePointerCancel = () => {
    endDrag();
  };

  return (
    <div className={`${ui.cardInset} rounded-2xl p-3 ring-1 ring-[rgba(200,138,75,0.12)]`}>
      <p className={`text-[9px] uppercase tracking-widest ${ui.muted} mb-2 leading-snug font-semibold`}>{label}</p>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onDec} className={ui.stepperBtn} aria-label="Decrease">
          −
        </button>

        <div
          className="relative flex items-center justify-center w-[4.75rem] h-[4.75rem] shrink-0 touch-none cursor-grab active:cursor-grabbing select-none"
          style={{ touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          role="slider"
          aria-valuenow={typeof display === 'number' ? display : undefined}
          aria-label={`${label}, swipe up or down to adjust`}
        >
          <GrinderDialFace rotationDeg={totalRotation} isDragging={isDragging} />
          <span
            className={`relative z-10 text-3xl font-black font-mono tabular-nums ${ui.text} drop-shadow-sm pointer-events-none`}
          >
            {display}
          </span>
        </div>

        <button type="button" onClick={onInc} className={ui.stepperBtn} aria-label="Increase">
          +
        </button>
      </div>
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
