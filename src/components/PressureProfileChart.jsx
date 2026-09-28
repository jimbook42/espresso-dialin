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

  const preDur = Math.max(preT, 6);
  const totalSec = Math.max(preDur + 28, 36);

  const x = (t) => padL + (t / totalSec) * chartW;
  const x0 = x(0);
  const xPreEnd = x(preDur);
  const xRampEnd = x(preDur + 4);
  const xHoldEnd = x(preDur + 22);
  const xEnd = x(totalSec);

  const yStart = yFor(pPre * 0.35);
  const yPre = yFor(pPre);
  const yPeak = yFor(pPeak);
  const yTaper = yFor(pTaper);

  const stroke = [
    `M ${x0} ${yStart}`,
    `Q ${x(xPreEnd * 0.45)} ${yStart} ${xPreEnd} ${yPre}`,
    `Q ${xRampEnd - (xRampEnd - xPreEnd) * 0.35} ${yPre} ${xRampEnd} ${yPeak}`,
    `Q ${(xRampEnd + xHoldEnd) / 2} ${yPeak} ${xHoldEnd} ${yPeak}`,
    `Q ${xHoldEnd + (xEnd - xHoldEnd) * 0.4} ${yPeak} ${xEnd} ${yTaper}`,
  ].join(' ');

  const area = `${stroke} L ${xEnd} ${yBase} L ${x0} ${yBase} Z`;

  return { stroke, area, maxP, totalSec, padL, padT, chartH, yBase };
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

  const progressX =
    progress != null && hasData
      ? padL + Math.min(1, Math.max(0, progress)) * chartW
      : null;

  return (
    <div className={`relative w-full ${compact ? 'h-[5.5rem]' : 'h-[6.25rem]'}`}>
      <div className="absolute inset-0 rounded-[10px] bg-[#121110] border border-[#232323] overflow-hidden">
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full" preserveAspectRatio="none" aria-hidden>
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
              {progressX != null && (
                <>
                  <line
                    x1={progressX}
                    x2={progressX}
                    y1={padT}
                    y2={padT + chartH}
                    stroke="#f5f2eb"
                    strokeWidth="1"
                    opacity="0.25"
                  />
                  <circle cx={progressX} cy={padT + chartH * 0.45} r="3.5" fill={AMBER} />
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
