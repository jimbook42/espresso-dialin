/** Floating shortcut (preview branch). Primary entry is in Settings. */
export function PressureLabEntry() {
  return (
    <button
      type="button"
      onClick={() => {
        window.location.hash = '#/flair-pressure-lab';
        window.location.reload();
      }}
      className="fixed bottom-24 right-3 z-[80] rounded-full bg-[#c88a4b] px-3 py-2 text-xs font-bold text-[#121110] shadow-lg"
    >
      Pressure lab (beta)
    </button>
  );
}
