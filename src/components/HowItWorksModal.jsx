import React from 'react';
import { Coffee, X } from 'lucide-react';

const SECTIONS = [
  {
    title: 'Target midpoints',
    body:
      'Your recipe defines a time window (min–max seconds). The engine uses the midpoint of that window as the “bullseye” for flow. How far your shot lands from that midpoint drives coarse grind moves when time is out of range.',
  },
  {
    title: 'Grinder sensitivity',
    body:
      'Each grinder maps seconds off-target to grind steps differently. The Sette uses fine micro-steps (~1.25s per step); the Sunbeam dial moves in larger steps (~4.5s per step). The same 5s fast shot therefore gets a smaller Sette correction than a Sunbeam correction.',
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
