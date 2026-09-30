import { ClipboardList, X } from 'lucide-react';

export function BrewGuideIntroModal({ open, onContinue, ui }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4 z-[60]">
      <div
        className={`${ui.card} w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto`}
        role="dialog"
        aria-labelledby="brew-guide-intro-title"
      >
        <div className={`flex items-center justify-between p-5 border-b ${ui.modalDivider} sticky top-0 ${ui.card} z-10`}>
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList className={`w-5 h-5 shrink-0 ${ui.accentText}`} aria-hidden />
            <h2 id="brew-guide-intro-title" className={`text-base font-bold ${ui.text}`}>
              Welcome to Brew Guide
            </h2>
          </div>
          <button type="button" onClick={onContinue} className={`${ui.ghostBtn} p-1`} aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-sm leading-relaxed">
          <p className={ui.sub}>
            Brew Guide walks you through your espresso workflow using your Dial-In recipe and grind setting.
          </p>
          <ul className={`space-y-2 ${ui.sub} list-disc pl-5`}>
            <li>Step-by-step brew workflow from heat-up to logging your shot</li>
            <li>Machine settings (brew temperature and pre-infusion) for the Barista Max</li>
            <li>Optional cleaning and descale programmes</li>
            <li>Optional milk texturing and drink guides</li>
          </ul>
          <p className={`text-xs ${ui.muted}`}>
            You can switch to a shorter checklist later whenever you like.
          </p>
        </div>

        <div className={`p-5 border-t ${ui.modalDivider}`}>
          <button type="button" onClick={onContinue} className={`w-full ${ui.primary} font-bold py-2.5 rounded-xl text-sm`}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
