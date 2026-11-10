import { useId, useMemo } from 'react';
import { generateShotInsights } from '../utils/shotInsights.js';

function Finding({ item, ui }) {
  if (!item) return null;
  return (
    <p className="break-words text-sm leading-snug">
      <span>{item.message}</span>
      {item.contextualDetail && <span className={`mt-1 block text-xs leading-relaxed ${ui.sub}`}>{item.contextualDetail}</span>}
    </p>
  );
}

export function ShotInsights({ shot, profile, ui }) {
  const headingId = useId();
  const insights = useMemo(() => generateShotInsights({ shot, profile }), [shot, profile]);
  const { mainTakeaway, observations, nextStep } = insights;

  return (
    <section className={`${ui.cardInset} min-w-0 rounded-xl p-3 space-y-2.5`} aria-labelledby={headingId}
      data-testid="shot-insights">
      <h3 id={headingId} className={`text-sm font-bold ${ui.text}`}>Shot insights</h3>
      {mainTakeaway && (
        <div className="min-w-0">
          <p className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${ui.accentText}`}>Main takeaway</p>
          <Finding item={mainTakeaway} ui={ui} />
        </div>
      )}
      {observations.length > 0 && (
        <div className="min-w-0">
          <p className={`mb-1.5 text-[10px] font-bold uppercase tracking-wide ${ui.muted}`}>Supporting observations</p>
          <ul className="space-y-2">
            {observations.map((item, index) => (
              <li key={`${item.category}-${index}`} className="border-l-2 border-[#c88a4b]/45 pl-2.5">
                <Finding item={item} ui={ui} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {nextStep && (
        <div className="min-w-0 border-t border-current/10 pt-2">
          <p className={`mb-1 text-[10px] font-bold uppercase tracking-wide ${ui.accentText}`}>Next step</p>
          <Finding item={nextStep} ui={ui} />
        </div>
      )}
    </section>
  );
}
