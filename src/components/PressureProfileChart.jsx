import { useId } from 'react';

const AMBER = '#c88a4b';

function buildSmoothProfilePath(profile, w, h, compact) {
  const preP = Number(profile?.preinfusionPressure) || 0;
  const preT = Number(profile?.preinfusionTime) || 0;
  const peakP = Number(profile?.peakPressure) || 0;
  const taperP = Number(profile?.taperPressure) || 0;
  const hasData = preP > 0 || peakP > 0 || taperP > 0;
  if (!hasData) return null;

  const padL = 4;
  const padR = 6;
  const padT = compact ? 14 : 16;
  const padB = compact ? 14 : 16;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;
  const yBase = padT + chartH;

  const pPre = preP || peakP * 0.35 || 2;
  const pPeak = peakP || preP || 9;
  const pTaper = taperP || peakP * 0.5 || 4.5;
  const maxP = Math.max(pPre, pPeak, pTaper, 1);
  const yFor = (p) => padT + chartH - (p / maxP) * chartH;

  const preDur = Math.max(preT, 4);
  const rampDur = 4;
  const holdDur = 22;
  const taperDur = 8;
  const totalSec = preDur + rampDur + holdDur + taperDur;

  const x = (t) => padL + (t / totalSec) * chartW;

  const t0 = 0;
  const t1 = preDur * 0.55;
  const t2 = preDur;
  const t3 = preDur + rampDur;
  const t4 = preDur + rampDur + holdDur;
  const t5 = totalSec;

  const y0 = yFor(pPre * 0.25);
  const yPre = yFor(pPre);
  const yPeak = yFor(pPeak);
  const yTaper = yFor(pTaper);

  // Cubic segments with strictly increasing time (monotonic X)
  const stroke = [
    `M ${x(t0)} ${y0}`,
    `C ${x(t0 + 1)} ${y0} ${x(t1 - 0.5)} ${yPre} ${x(t1)} ${yPre}`,
    `L ${x(t2)} ${yPre}`,
    `C ${x(t2 + 1)} ${yPre} ${x(t3 - 1)} ${yPeak} ${x(t3)} ${yPeak}`,
    `L ${x(t4)} ${yPeak}`,
    `C ${x(t4 + 2)} ${yPeak} ${x(t5 - 1)} ${yTaper} ${x(t5)} ${yFor(pTaper * 0.9)}`,
  ].join(' ');

  const area = `${stroke} L ${x(t5)} ${yBase} L ${x(t0)} ${yBase} Z`;

  return { stroke, area, maxP, totalSec, padL, padT, chartH, yBase, chartW, yFor, pPre, pPeak, pTaper, preDur, rampDur, taperDur };
}

function pressureAtElapsed(built, tSec) {
  const { preDur, rampDur, taperDur, totalSec, pPre, pPeak, pTaper } = built;
  const t1 = preDur * 0.55;
  const t2 = preDur;
  const t3 = preDur + rampDur;
  const t4 = preDur + rampDur + (totalSec - preDur - rampDur - taperDur);
  const t = Math.min(Math.max(tSec, 0), totalSec);
  const pStart = pPre * 0.25;
  const pEnd = pTaper * 0.9;

  if (t <= t1) {
    const frac = t1 > 0 ? t / t1 : 1;
    return pStart + (pPre - pStart) * frac;
  }
  if (t <= t2) return pPre;
  if (t <= t3) {
    const frac = rampDur > 0 ? (t - t2) / rampDur : 1;
    return pPre + (pPeak - pPre) * frac;
  }
  if (t <= t4) return pPeak;
  if (t <= totalSec) {
    const frac = taperDur > 0 ? (t - t4) / taperDur : 1;
    return pPeak + (pEnd - pPeak) * frac;
  }
  return pEnd;
}

function markerAtProgress(built, progress) {
  const p = Math.min(1, Math.max(0, progress));
  const tSec = p * built.totalSec;
  const pressure = pressureAtElapsed(built, tSec);
  const x = built.padL + p * built.chartW;
  const y = built.yFor(pressure);
  return { x, y, tSec };
}

/** Smooth Flair-style pressure curve (display only). */
export function PressureProfileChart({ profile, progress = null, compact = false }) {
  const gradId = useId().replace(/:/g, '');
  const w = 340;
  const h = compact ? 88 : 100;
  const built = buildSmoothProfilePath(profile, w, h, compact);
  const hasData = built !== null;

  const padL = 4;
  const padR = 6;
  const padT = compact ? 14 : 16;
  const padB = compact ? 14 : 16;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  const marker =
    progress != null && hasData ? markerAtProgress(built, progress) : null;

  return (
    <div className={`relative w-full ${compact ? 'h-[5.5rem]' : 'h-[6.25rem]'}`}>
      <div className="absolute inset-0 rounded-[10px] bg-[#121110] border border-[#232323] overflow-hidden">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1={padL}
              x2={w - padR}
              y1={padT + (chartH / 3) * i}
              y2={padT + (chartH / 3) * i}
              stroke="#252525"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          ))}

          {hasData ? (
            <>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={AMBER} />
                  <stop offset="100%" stopColor={AMBER} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={built.area} fill={`url(#${gradId})`} opacity="0.14" />
              <path
                d={built.stroke}
                fill="none"
                stroke={AMBER}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {marker != null && (
                <>
                  <line
                    x1={marker.x}
                    x2={marker.x}
                    y1={padT}
                    y2={padT + chartH}
                    stroke="#f5f2eb"
                    strokeWidth="1"
                    opacity="0.25"
                  />
                  <circle cx={marker.x} cy={marker.y} r="3.5" fill={AMBER} stroke="#121110" strokeWidth="1" />
                </>
              )}
              <text x={padL + 2} y={padT + 2} fill="#5a5754" fontSize="9" fontFamily="system-ui, sans-serif">
                {built.maxP} bar
              </text>
              <text x={padL + 2} y={h - 4} fill="#5a5754" fontSize="9" fontFamily="system-ui, sans-serif">
                0 bar
              </text>
              <text x={w - padR - 2} y={h - 4} fill="#5a5754" fontSize="9" textAnchor="end" fontFamily="system-ui, sans-serif">
                0s — {Math.round(built.totalSec)}s
              </text>
            </>
          ) : (
            <>
              <path
                d={`M ${padL} ${padT + chartH * 0.55} Q ${w * 0.35} ${padT + chartH * 0.2} ${w * 0.55} ${padT + chartH * 0.35} T ${w - padR} ${padT + chartH * 0.7}`}
                fill="none"
                stroke="#3d3830"
                strokeWidth="1.5"
                strokeDasharray="5 5"
                opacity="0.55"
              />
              <text x={w / 2} y={padT + chartH / 2} fill="#6b6457" fontSize="10" textAnchor="middle">
                Add pressure steps on Beans
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
