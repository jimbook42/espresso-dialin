import { getShotEngineStats, knownIssueReasonLabel } from '../utils/grinderLogic';
import { formatSecondsPerStepDisplay } from '../utils/grinderSensitivityDisplay.js';
import { buildShotEngineStatsRows } from './shotEngineStatsRows.js';

export function ShotEngineStatsPanel({ shot, recipe, ui }) {
  const stats = getShotEngineStats(shot, recipe);

  const exclusionLine =
    shot?.excludeFromLearning
      ? `Excluded from learning${shot.knownIssueReason ? `: ${knownIssueReasonLabel(shot.knownIssueReason)}` : ''}`
      : null;

  const rows = buildShotEngineStatsRows(stats, shot, formatSecondsPerStepDisplay);

  return (
    <div className={`${ui.inset} rounded-xl p-3 space-y-2 text-[10px] leading-relaxed`}>
      {exclusionLine && (
        <p className={`font-semibold ${ui.accentText}`}>{exclusionLine}</p>
      )}
      {stats.severeChoke && (
        <p className="text-rose-400/90 font-semibold">Severe choke logic was applied for this recommendation.</p>
      )}
      {stats.tasteOverride && (
        <p className={ui.muted}>In-range taste override influenced the grind shift.</p>
      )}
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,42%)_1fr] gap-2">
            <dt className={`${ui.muted} uppercase tracking-wide font-bold`}>{row.label}</dt>
            <dd className={`${ui.sub} font-mono text-[10px] break-words`}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {stats.warning && (
        <p className={`pt-1 border-t ${ui.modalDivider} ${ui.muted} italic`}>{stats.warning}</p>
      )}
    </div>
  );
}
