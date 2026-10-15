const TOAST_DURATION_MS = 8000;

export { TOAST_DURATION_MS };

export function FinishBeanToast({ beanName, onUndo, ui }) {
  return (
    <div
      className={`fixed left-0 right-0 z-[55] px-4 pointer-events-none`}
      style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
      role="status"
      aria-live="polite"
      data-testid="bean-finished-toast"
    >
      <div
        className={`max-w-xl mx-auto ${ui.card} border shadow-lg rounded-xl px-4 py-3 flex items-center justify-between gap-3 pointer-events-auto`}
      >
        <p className={`text-xs sm:text-sm font-semibold ${ui.text} min-w-0 truncate`}>
          {beanName} marked finished
        </p>
        <button
          type="button"
          onClick={onUndo}
          className={`shrink-0 text-xs font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg border ${ui.secondaryBtn}`}
          data-testid="bean-finished-undo"
        >
          Undo
        </button>
      </div>
    </div>
  );
}
