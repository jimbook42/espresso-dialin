import { Coffee, X } from 'lucide-react';

const SECTIONS = [
  {
    title: 'Supported grinders',
    body:
      'The engine works with Baratza Sette 270Wi, Sunbeam Barista Max, Niche Zero, and many standalone presets (Breville Smart Grinder Pro, Baratza Encore ESP, Fellow Opus / Opus 2, Mazzer Philos, Eureka Mignon models, Zerno Z1, built-in grinders on Breville Barista Express / Pro / Touch, DF64 Gen 2, DF54, and Timemore Sculptor 064S). You can also define a custom dial range if your grinder is not listed.',
  },
  {
    title: 'Target midpoints',
    body:
      'Your recipe defines a time window (min–max seconds). The engine uses the midpoint of that window as the “bullseye” for flow. How far your shot lands from that midpoint drives coarse grind moves when time is out of range.',
  },
  {
    title: 'Grinder sensitivity',
    body:
      'Each grinder maps seconds off-target to grind steps using its catalog sensitivity (seconds per step). Sette micro-steps move in smaller time chunks than the Sunbeam dial; preset and custom grinders use their own ranges and step sizes. Niche Zero stays qualitative until enough of your shots build a learned slope. Newer presets (Barista Express / Pro / Touch built-ins, DF64 Gen 2, DF54, Sculptor 064S) and custom grinders label recommendations Estimated until your logged shots raise confidence.',
  },
  {
    title: 'Age & freshness',
    body:
      'Bean age (including freeze/thaw and vacuum storage) adjusts the starting grind before you log shots. As beans age, the app may nudge finer; very fresh beans nudge coarser. After your first shots, learning follows your logged results; dynamic age shifts also apply between sessions when bean age changes a lot.',
  },
  {
    title: 'Taste overrides',
    body:
      'When time is already in range, taste wins: sour → finer, bitter → coarser, with stronger steps for “very” sour or bitter. A balanced taste in range means keep the grind. Ratio and temperature hints may appear when time is right but taste keeps repeating.',
  },
  {
    title: 'Smart scale',
    body:
      'Pick a supported scale in Settings to show live cup weight on the Dial and timer, plus live flow while you pull. Optional shot-start countdown (3-2-1) can tare the scale before the timer runs. When you stop, the app waits about one second for the cup to settle, then locks yield and stores average flow on the shot when a scale was connected. Manual logging still works without a scale.',
  },
  {
    title: 'Brew Guide',
    body:
      'Brew Guide is the beginner-friendly, step-by-step path through heat-up, puck prep, extraction, and logging — using your recipe and current grind. Sunbeam owners get machine-specific steps; everyone else gets a shorter checklist option once you are comfortable.',
  },
  {
    title: 'Basket adjustments',
    body:
      '“Changed basket” applies a one-time grind tweak to the next recommendation only (not saved to learning): more holes / faster flow nudges finer; fewer holes / tighter flow nudges coarser. Purge after any grind change so retention does not skew the next shot.',
  },
  {
    title: 'Beans & history',
    body:
      'Mark a bag finished when it is empty; an undo toast lets you reverse a mistaken tap. Finished beans move to a collapsible list and are skipped when picking the active bag.',
  },
  {
    title: 'Known issues',
    body:
      'Mark a shot as a known issue (puck prep, stopped early, overheated grounds, etc.) to keep it in history but exclude it from learning. Those shots won’t move future recommendations or roast baselines.',
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
            Recommendations combine your recipe targets, grinder math, bean freshness, and your shot history. This is a guide — puck prep and machine behaviour always matter.
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
