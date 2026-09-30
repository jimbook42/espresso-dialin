import { X } from 'lucide-react';

export function BrewGraduationPrompt({
  ui,
  onUseQuickChecklist,
  onKeepFullGuide,
  onNoChecklist,
  onDismiss,
}) {
  return (
    <div className={`${ui.cardInset} rounded-2xl p-4 space-y-3 relative`}>
      <button
        type="button"
        onClick={onDismiss}
        className={`absolute top-3 right-3 p-1 ${ui.ghostBtn}`}
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="pr-8">
        <p className={`text-sm font-bold ${ui.text}`}>Ready for a quicker workflow?</p>
        <p className={`text-xs leading-relaxed mt-1 ${ui.sub}`}>
          You&apos;ve used the Brew Guide a few times. You can switch to a short checklist for your normal workflow.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={onUseQuickChecklist}
          className={`w-full min-h-[44px] rounded-xl text-sm font-bold ${ui.primary}`}
        >
          Use Quick Checklist
        </button>
        <button
          type="button"
          onClick={onKeepFullGuide}
          className={`w-full min-h-[44px] rounded-xl text-sm font-bold ${ui.secondaryBtn}`}
        >
          Keep Full Guide
        </button>
        <button
          type="button"
          onClick={onNoChecklist}
          className={`w-full min-h-[40px] rounded-xl text-xs font-bold ${ui.ghostBtn}`}
        >
          I don&apos;t need a checklist
        </button>
      </div>
    </div>
  );
}
