export function BrewGuidanceSwitch({ ui, onUseQuickChecklist, compact = false }) {
  if (compact) {
    return (
      <div className={`text-center space-y-2 pt-2 ${compact ? '' : 'pb-2'}`}>
        <p className={`text-xs ${ui.muted}`}>Want a shorter checklist?</p>
        <button
          type="button"
          onClick={onUseQuickChecklist}
          className={`text-xs font-bold ${ui.accentText}`}
        >
          Use Quick Checklist
        </button>
      </div>
    );
  }

  return (
    <div className={`${ui.cardInset} rounded-xl p-4 space-y-2 text-center`}>
      <p className={`text-sm font-bold ${ui.text}`}>Want a shorter checklist?</p>
      <p className={`text-xs ${ui.sub}`}>Switch to a quick checklist whenever you&apos;re ready.</p>
      <button
        type="button"
        onClick={onUseQuickChecklist}
        className={`w-full min-h-[44px] rounded-xl text-sm font-bold ${ui.ctaSoft}`}
      >
        Use Quick Checklist
      </button>
    </div>
  );
}
