import { Coffee, X } from 'lucide-react';

const SECTIONS = [
  {
    title: 'Supported grinders',
    body:
      'Recommendations are grinder-specific. Supported models include Baratza Sette 270Wi, Sunbeam Barista Max, Niche Zero, presets (Breville Smart Grinder Pro BCG820, Baratza Encore ESP, Fellow Opus / Opus 2, Mazzer Philos, Eureka Mignon Specialità / Zero variants, Zerno Z1, Breville Barista Express BES870/875, Barista Pro BES878, Barista Touch BES880, DF64 Gen 2, DF54, Timemore Sculptor 064S), and “Not listed — custom grinder” with your own dial range.',
  },
  {
    title: 'Time target & Δt',
    body:
      'Your recipe sets a shot-time window (min–max seconds). The engine uses t_mid = (min + max) / 2. Off-target timing uses Δt = shot time − t_mid to size coarse grind moves when the shot lands outside the window.',
  },
  {
    title: 'Sensitivity (s/step)',
    body:
      'Each grinder has a catalog sensitivity in seconds per dial step (Sette micro-steps, Sunbeam dial settings, preset/custom stepped or stepless ranges). Grind shifts scale with Δt using proportional damping. Niche Zero uses reference-dial learning — no fixed catalog s/step until enough shots build an empirical slope. Newer built-in presets (Barista Express / Pro / Touch, DF64 Gen 2, DF54, Sculptor 064S) and custom grinders show an Estimated label on recommendations until learned confidence ≥ 0.75.',
  },
  {
    title: 'Effective age & freshness offset',
    body:
      'Effective bean age (days) uses roast date plus storage (Standard Bag, Vacuum Sealed Bag, Frozen Storage / thaw). That maps to a starting-grind offset in dial steps before shot learning. If bean age shifts a lot vs your last logged shot, the recommendation card can show a freshness notice and adjust the suggested grind.',
  },
  {
    title: 'In-range taste override',
    body:
      'When shot time is inside the recipe window, taste drives step direction and size: sour → finer, bitter → coarser (stronger for “very sour” / “very bitter”). Balanced taste in range → hold grind. Persistent in-range sour or bitter can add ratio advisory text, or Flair brew-temperature hints when “Enable Flair manual profile” is on.',
  },
  {
    title: 'Smart scale',
    body:
      'In Settings, choose a model under Smart scale for live cup weight (g) and extraction flow (g/s) on Dial-In and the shot timer when connected. Optional Shot start countdown (3-2-1) can tare the scale before the timer runs. On stop, ~1 s settle, then yield is filled and mean flow (g/s) is saved on the shot in History when a scale was connected. Manual logging still works without a scale.',
  },
  {
    title: 'Brew Guide',
    body:
      'The Brew Guide tab walks heat-up → prep → extract → log using your recipe and grind. Sunbeam Barista Max loads machine-specific steps. In Settings, “Brew guidance on Dial-In” can be Full guide (Brew Guide tab), Quick checklist on Dial-In, or No checklist.',
  },
  {
    title: 'Changed basket',
    body:
      'The Changed basket control on Dial-In applies a one-time grind tweak to the next recommendation only (not saved to learning): More holes / faster flow → finer; Fewer holes / tighter flow → coarser. Log “Grinder purged?” as Yes — Purged after grind changes so retention does not skew the next shot.',
  },
  {
    title: 'Finished beans',
    body:
      'Mark beans as finished when a bag is empty; the “marked finished” toast offers Undo. Finished bags appear under Finished on the Beans list and are skipped when choosing the active bean.',
  },
  {
    title: 'Known issues',
    body:
      'Toggle Known issue — don’t use for learning on a shot to keep it in History but exclude it from grind learning and roast baselines.',
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
            Grind recommendations combine recipe targets (time, dose, yield), grinder sensitivity (s/step or learned slope), bean effective age, and recipe-matched shot history. Puck prep and machine behaviour are not modeled.
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
