import { Coffee, X } from 'lucide-react';

const SECTIONS = [
  {
    title: 'Grinder registry',
    body:
      'Recommendations are grinder-specific. Supported identities include Baratza Sette 270Wi, Sunbeam Barista Max, Niche Zero, preset models (Breville Smart Grinder Pro BCG820, Baratza Encore ESP, Fellow Opus / Opus 2, Mazzer Philos, Eureka Mignon Specialità / Zero variants, Zerno Z1, Breville Barista Express BES870/875, Barista Pro BES878, Barista Touch BES880, DF64 Gen 2, DF54, Timemore Sculptor 064S), and a user-defined custom dial range.',
  },
  {
    title: 'Time target & Δt',
    body:
      'Recipe stores targetTimeMinS and targetTimeMaxS. The engine uses t_mid = (min + max) / 2. Off-target timing uses Δt = actualTimeS − t_mid to size coarse grind moves when actualTimeS is outside [min, max].',
  },
  {
    title: 'Sensitivity (s/step)',
    body:
      'Each grinder definition supplies a catalog sensitivity in seconds per dial step (Sette: micro-steps; Sunbeam: dial settings; presets/custom: stepped or stepless ranges). Shifts scale with Δt via proportional damping. Niche Zero uses reference-dial learning — no fixed catalog s/step; empirical slope when eligible. Held-back presets (Barista Express / Pro / Touch built-ins, DF64 Gen 2, DF54, Sculptor 064S) and custom grinders prefix grind reasons ESTIMATED until learned confidence ≥ 0.75.',
  },
  {
    title: 'Effective age & freshness offset',
    body:
      'Bean effective age (days) incorporates roast date and storageType (bag, vacuum, frozen/thaw). Freshness maps to a starting-grind offset in dial steps before shot learning. Between sessions, large age deltas vs your last logged shot can apply a dynamic grind shift (ageWarning on the recommendation card).',
  },
  {
    title: 'In-range taste override',
    body:
      'When actualTimeS is inside the recipe window, tasteProfile drives step direction and magnitude (sour → finer, bitter → coarser; stronger for very_sour / very_bitter). Balanced taste in range → hold grind. Persistent in-range sour/bitter can surface ratio advisory text or Flair brew-temperature hints when enabled.',
  },
  {
    title: 'Smart scale integration',
    body:
      'Settings smartScaleDeviceId enables live cup weight (g) and extraction flow (g/s) on Dial/timer when BLE-connected. Optional shot-start countdown (3-2-1) calls scale tare during countdown prep. On stop: ~1000 ms yield settle (SHOT_YIELD_SETTLE_MS), then actualYieldG is set and scaleFlowRateGs / scaleFlowCurve are persisted on the shot when recorded. Manual entry remains available without a scale.',
  },
  {
    title: 'Brew Guide',
    body:
      'Full Brew Guide tab: ordered workflow (heat-up → prep → extract → log) bound to active recipe and grind. Sunbeam (brewGuideMachineKey) loads machine-specific steps; brewGuideGuidanceMode can switch to a quick checklist on Dial-In or disable guidance.',
  },
  {
    title: 'Basket change (display-only)',
    body:
      '“Changed basket” applies applyBasketChangeToRecommendation once: more holes / faster flow → finer shift; fewer holes / tighter flow → coarser shift. Adjusts the displayed recommendation only — not persisted to learning. Purge after grind changes (wasPurged) to avoid retention skew.',
  },
  {
    title: 'Bean lifecycle',
    body:
      'isFinished marks an empty bag; FinishBeanToast supports undo. Finished beans list separately and are excluded from active-bean selection.',
  },
  {
    title: 'Known issues (excludeFromLearning)',
    body:
      'Flagging a known issue keeps the shot in history but sets excludeFromLearning so it does not update grind learning or roast baselines.',
  },
];

export function HowItWorksModal({ open, onClose, ui }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[60]">
      <div
        className={`${ui.card} w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto`}
        role="dialog"
        aria-labelledby="how-it-works-title"
      >
        <div className={`flex items-center justify-between p-5 border-b ${ui.modalDivider} sticky top-0 ${ui.card} z-10`}>
          <div className="flex items-center gap-2 min-w-0">
            <Coffee className={`w-5 h-5 shrink-0 ${ui.accentText}`} />
            <h2 id="how-it-works-title" className={`text-base font-bold ${ui.text}`}>
              How the engine works
            </h2>
          </div>
          <button type="button" onClick={onClose} className={`${ui.ghostBtn} p-1`} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 text-xs leading-relaxed">
          <p className={ui.sub}>
            Grind recommendations are computed from recipe targets (time, dose, yield), grinder sensitivity (s/step or learned slope), bean effective age, and recipe-matched shot history. Puck prep and machine behaviour are not modeled.
          </p>

          {SECTIONS.map((section) => (
            <div key={section.title} className={`${ui.cardInset} rounded-xl p-3.5 space-y-1.5`}>
              <h3 className={`${ui.sectionTitle}`}>{section.title}</h3>
              <p className={ui.sub}>{section.body}</p>
            </div>
          ))}
        </div>

        <div className={`p-5 border-t ${ui.modalDivider}`}>
          <button type="button" onClick={onClose} className={`w-full ${ui.primary} font-bold py-2.5 rounded-xl text-sm`}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
