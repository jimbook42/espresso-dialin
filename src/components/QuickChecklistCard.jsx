import { ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import { useState } from 'react';
import { buildQuickChecklist } from '../brewGuide/guidance';

export function QuickChecklistCard({
  ui,
  accessories,
  dial,
  onOpenFullGuide,
}) {
  const [expanded, setExpanded] = useState(true);
  const items = buildQuickChecklist(accessories, dial);

  return (
    <div className={`${ui.card} rounded-2xl overflow-hidden`}>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between gap-3 p-4 text-left min-h-[48px]"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardList className={`w-4 h-4 shrink-0 ${ui.accentText}`} aria-hidden />
          <span className={`text-sm font-bold ${ui.text}`}>Quick checklist</span>
        </div>
        {expanded ? (
          <ChevronUp className={`w-4 h-4 shrink-0 ${ui.muted}`} aria-hidden />
        ) : (
          <ChevronDown className={`w-4 h-4 shrink-0 ${ui.muted}`} aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-[rgba(255,255,255,0.06)]">
          <ul className={`space-y-1.5 text-xs leading-relaxed ${ui.sub} pt-3`}>
            {items.map((item) => (
              <li key={item.id} className="flex gap-2">
                <span className={`mt-1.5 w-1 h-1 rounded-full shrink-0 ${ui.accentText} bg-current`} aria-hidden />
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onOpenFullGuide}
            className={`text-xs font-bold ${ui.accentText} pt-1`}
          >
            Need the full guide? Open Full Guide
          </button>
        </div>
      )}
    </div>
  );
}
