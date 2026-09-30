import { DIAGNOSTIC_HISTORY_MS } from './diagnosticHistory.js';
import { wrap360, wrapDelta } from './gaugeConfig.js';

const STATE_COLOR = {
  CALIBRATING: '#a8a29e',
  TRACKING: '#34d399',
  UNCERTAIN: '#fbbf24',
  LOST: '#fb7185',
};

function unwrap(samples, pick) {
  const values = [];
  let acc = null;
  let prev = null;
  for (const sample of samples) {
    const value = pick(sample);
    if (value == null || Number.isNaN(value)) {
      values.push(null);
      prev = null;
      continue;
    }
    if (prev == null) {
      acc = 0;
      prev = value;
      values.push(0);
      continue;
    }
    acc += wrapDelta(prev, value);
    prev = value;
    values.push(acc);
  }
  return values;
}

function extent(values, fallback = 1) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value == null) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min)) return { min: 0, max: fallback };
  if (max - min < 1e-3) return { min: min - fallback / 2, max: max + fallback / 2 };
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

function linePath(samples, values, xOf, yOf) {
  let path = '';
  let drawing = false;
  samples.forEach((sample, index) => {
    const value = values[index];
    if (value == null) {
      drawing = false;
      return;
    }
    path += `${drawing ? 'L' : 'M'}${xOf(sample.t).toFixed(1)} ${yOf(value).toFixed(1)}`;
    drawing = true;
  });
  return path;
}

function Lane({ title, samples, values, xOf, yOf, color, width, y, height }) {
  return (
    <g>
      <text x="0" y={y + 10} fill="#a8a29e" fontSize="8">{title}</text>
      <line x1="46" x2={width} y1={y + height} y2={y + height} stroke="#44403c" strokeWidth="0.5" />
      <path d={linePath(samples, values, xOf, (value) => y + yOf(value) * height)} fill="none" stroke={color} strokeWidth="1.4" />
    </g>
  );
}

/** Last 30 seconds of lab readings. Render only — the buffer is not stored. */
export function DiagnosticTrace({ samples }) {
  if (!samples?.length) {
    return (
      <p className="text-[11px] text-[#a8a29e]">
        The trace fills while the camera is running. It keeps about 30 seconds and clears when the camera stops.
      </p>
    );
  }

  const width = 320;
  const height = 168;
  const end = samples[samples.length - 1].t;
  const start = end - DIAGNOSTIC_HISTORY_MS;
  const xOf = (t) => 46 + ((t - start) / DIAGNOSTIC_HISTORY_MS) * (width - 50);

  const pressure = samples.map((sample) => (sample.pressure == null ? null : sample.pressure));
  const raw = unwrap(samples, (sample) => sample.rawAngle);
  const smoothed = unwrap(samples, (sample) => (
    sample.smoothedAngle == null ? null : wrap360(sample.smoothedAngle + (sample.gaugeRotation || 0))
  ));
  const quality = samples.map((sample) => (sample.quality == null ? null : sample.quality));
  const confidence = samples.map((sample) => (sample.gaugeConfidence == null ? null : sample.gaugeConfidence));
  const origin = samples.find((sample) => sample.gaugeX != null);
  const dx = samples.map((sample) => (
    sample.gaugeX == null || origin?.gaugeX == null ? null : sample.gaugeX - origin.gaugeX
  ));
  const dy = samples.map((sample) => (
    sample.gaugeY == null || origin?.gaugeY == null ? null : sample.gaugeY - origin.gaugeY
  ));
  const motion = extent([...dx, ...dy], 8);
  const angles = extent([...raw, ...smoothed], 8);

  const unit = (value, min, max) => 1 - (value - min) / (max - min);
  const lane = (title, values, color, y, scale) => (
    <Lane
      title={title}
      samples={samples}
      values={values}
      xOf={xOf}
      yOf={(value) => unit(value, scale.min, scale.max)}
      color={color}
      width={width}
      y={y}
      height={28}
    />
  );

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Pressure lab trace for the last 30 seconds">
        {lane('bar', pressure, '#e0c9a8', 2, { min: 0, max: 12 })}
        {lane('angle', raw, '#d6d3d1', 36, angles)}
        <path
          d={linePath(samples, smoothed, xOf, (value) => 36 + unit(value, angles.min, angles.max) * 28)}
          fill="none"
          stroke="#fafaf9"
          strokeWidth="1.1"
          strokeDasharray="3 2"
        />
        {lane('score', quality, '#6ee7b7', 70, { min: 0, max: 1 })}
        <path
          d={linePath(samples, confidence, xOf, (value) => 70 + unit(value, 0, 1) * 28)}
          fill="none"
          stroke="#93c5fd"
          strokeWidth="1.2"
        />
        {lane('move', dx, '#f9a8d4', 104, motion)}
        <path
          d={linePath(samples, dy, xOf, (value) => 104 + unit(value, motion.min, motion.max) * 28)}
          fill="none"
          stroke="#67e8f9"
          strokeWidth="1.2"
        />
        {samples.map((sample, index) => {
          const next = samples[index + 1]?.t ?? end;
          const x = xOf(sample.t);
          const w = Math.max(1.2, xOf(next) - x);
          return (
            <rect
              key={`${sample.t}-${index}`}
              x={x}
              y={142}
              width={w}
              height={8}
              fill={STATE_COLOR[sample.tracking] || '#78716c'}
            />
          );
        })}
        <text x="0" y="150" fill="#a8a29e" fontSize="8">state</text>
      </svg>
      <p className="text-[10px] text-[#a8a29e] leading-relaxed mt-1">
        Amber is pressure. Gray is raw screen angle and the dashed line is the smoothed screen angle, both unwrapped from the first sample.
        Green is needle score, blue is gauge confidence. Pink is gauge Δx and cyan is Δy, in pixels from the first sample in this window.
        The strip is tracking state. Nothing here is saved.
      </p>
    </div>
  );
}
