import { CheckCircle, ChevronDown, ChevronUp, Edit2, Trash2 } from 'lucide-react';
import { partitionBeansByFinished } from '../utils/beanFinishActions.js';
import { beanIsDecaf } from '../utils/grinderLogic';

function BeanListRow({
  bean,
  ui,
  subTextClass,
  inputClass,
  currentTheme,
  onEdit,
  onToggleFinished,
  onMarkActive,
  onDelete,
  onUpdateRating,
}) {
  const finished = Boolean(bean.isFinished);

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-xl ${ui.inset} text-xs ${finished ? 'opacity-60' : ''}`}
      data-testid={finished ? 'bean-row-finished' : 'bean-row-active'}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onEdit(bean)}
          className={`${currentTheme.text} hover:opacity-70 p-1 bg-amber-500/10 rounded-md`}
          title="Edit Bean"
        >
          <Edit2 className="w-4 h-4" />
        </button>
        {finished ? (
          <button
            type="button"
            onClick={() => onMarkActive(bean.id)}
            data-testid="mark-bean-active"
            className="px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-400 font-semibold text-[10px] uppercase tracking-wide"
          >
            Mark active
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onToggleFinished(bean.id, bean.isFinished)}
            className={`p-1 rounded-md ${ui.chip}`}
            title="Mark Finished"
          >
            <CheckCircle className="w-4 h-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(bean.id)}
          className="text-rose-500 hover:opacity-70 p-1 bg-rose-500/10 rounded-md"
          title="Delete Bean Profile"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <div>
          <span className={`font-bold ${ui.text} block`}>{bean.name}</span>
          <span className={`text-[10px] ${subTextClass}`}>
            {bean.roaster} • {bean.roastType} Roast ({bean.storageType})
            {beanIsDecaf(bean) ? ' • Decaf' : ''}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[10px] uppercase font-bold ${ui.muted}`}>Rating:</span>
        <input
          type="number"
          step="0.1"
          min="1.0"
          max="10.0"
          placeholder="e.g. 9.2"
          value={bean.rating !== null && bean.rating !== undefined ? bean.rating : ''}
          onChange={(e) => onUpdateRating(bean.id, e.target.value)}
          className={`w-16 ${inputClass} border rounded-lg p-1.5 text-center text-xs font-bold text-amber-500`}
        />
      </div>
    </div>
  );
}

export function PastBeansList({
  beans,
  finishedSectionOpen,
  onToggleFinishedSection,
  ui,
  subTextClass,
  inputClass,
  currentTheme,
  onEdit,
  onToggleFinished,
  onMarkActive,
  onDelete,
  onUpdateRating,
}) {
  const { activeBeans, finishedBeans, finishedCount } = partitionBeansByFinished(beans);

  if (beans.length === 0) {
    return <p className={`text-xs ${subTextClass}`}>No beans logged yet.</p>;
  }

  const rowProps = {
    ui,
    subTextClass,
    inputClass,
    currentTheme,
    onEdit,
    onToggleFinished,
    onMarkActive,
    onDelete,
    onUpdateRating,
  };

  return (
    <div className="space-y-3">
      {activeBeans.map((b) => (
        <BeanListRow key={b.id} bean={b} {...rowProps} />
      ))}

      {finishedCount > 0 && (
        <div className="pt-1" data-testid="beans-finished-section">
          <button
            type="button"
            onClick={onToggleFinishedSection}
            data-testid="beans-finished-section-toggle"
            aria-expanded={finishedSectionOpen}
            aria-controls="beans-finished-section-panel"
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl border ${ui.chip} font-semibold text-xs`}
          >
            <span>Finished ({finishedCount})</span>
            {finishedSectionOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {finishedSectionOpen && (
            <div id="beans-finished-section-panel" className="space-y-3 mt-3">
              {finishedBeans.map((b) => (
                <BeanListRow key={b.id} bean={b} {...rowProps} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
