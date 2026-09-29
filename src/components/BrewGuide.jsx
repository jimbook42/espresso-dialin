import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  Bean,
  CircleDot,
  ClipboardList,
  Coffee,
  CupSoda,
  Disc,
  Droplets,
  FlaskConical,
  Funnel,
  Pin,
  Scale,
} from 'lucide-react';
import { SettingsToggle } from './SettingsToggle';
import {
  BREW_ACCESSORIES,
  brewDialIsReady,
  buildBrewSteps,
  formatBrewAmount,
  normalizeBrewAccessories,
} from '../brewGuide/steps';

const ACCESSORY_ICONS = {
  dosingCup: CupSoda,
  dosingFunnel: Funnel,
  rdt: Droplets,
  blindShaker: FlaskConical,
  wdt: Pin,
  distributor: CircleDot,
  selfLevellingTamper: ArrowDownToLine,
  puckScreen: Disc,
};

const STEP_ICONS = {
  recipe: Scale,
  rdt: Droplets,
  grind: Bean,
  shake: FlaskConical,
  transfer: ArrowDown,
  wdt: Pin,
  funnel: Funnel,
  distribute: CircleDot,
  tamp: ArrowDownToLine,
  screen: Disc,
  ready: Coffee,
};

function ToolMark({ icon: Icon, ui }) {
  return (
    <div className={`${ui.cardInset} w-14 h-14 rounded-2xl flex items-center justify-center shrink-0`}>
      <Icon className={`w-7 h-7 ${ui.accentText}`} aria-hidden />
    </div>
  );
}

export function BrewGuide({ ui, accessories, setupComplete, onSaveAccessories, onOpenDial, dial }) {
  const [screen, setScreen] = useState(setupComplete ? 'intro' : 'setup');
  const [draft, setDraft] = useState(() => normalizeBrewAccessories(accessories));
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);

  const steps = buildBrewSteps(accessories, dial);
  const index = Math.min(stepIndex, Math.max(steps.length - 1, 0));
  const step = steps[index];
  const canStart = brewDialIsReady(dial);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, index]);

  const openSetup = () => {
    setDraft(normalizeBrewAccessories(accessories));
    setScreen('setup');
  };

  const saveSetup = async () => {
    setSaving(true);
    try {
      await onSaveAccessories(draft);
      setScreen('intro');
    } finally {
      setSaving(false);
    }
  };

  const start = () => {
    if (!canStart) return;
    setStepIndex(0);
    setScreen('steps');
  };

  if (screen === 'setup') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <p className={ui.pageTitle}>Brew Guide</p>
          <h2 className={`text-2xl font-black tracking-tight ${ui.text}`}>What do you use?</h2>
          <p className={`text-sm leading-relaxed ${ui.sub}`}>
            Turn on the tools you have. Steps for anything left off will not appear.
          </p>
        </div>

        <div className="space-y-3">
          {BREW_ACCESSORIES.map((item) => {
            const Icon = ACCESSORY_ICONS[item.id] || ClipboardList;
            return (
              <div key={item.id} className={`${ui.card} p-4 rounded-2xl flex gap-3`}>
                <div className={`${ui.cardInset} w-11 h-11 rounded-xl flex items-center justify-center shrink-0`}>
                  <Icon className={`w-5 h-5 ${ui.accentText}`} aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <span className={`font-bold ${ui.text}`}>{item.name}</span>
                    <SettingsToggle
                      checked={Boolean(draft[item.id])}
                      onChange={(next) => setDraft((prev) => ({ ...prev, [item.id]: next }))}
                      label={item.name}
                    />
                  </div>
                  <p className={`text-xs leading-relaxed mt-1.5 ${ui.sub}`}>{item.explanation}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-2 pt-1">
          <button
            type="button"
            onClick={saveSetup}
            disabled={saving}
            className={`w-full min-h-[64px] rounded-xl text-base ${ui.primary} disabled:opacity-60`}
          >
            {setupComplete ? 'Save' : 'Continue'}
          </button>
          {setupComplete && (
            <button
              type="button"
              onClick={() => setScreen('intro')}
              className={`w-full min-h-[48px] rounded-xl text-sm font-bold ${ui.secondaryBtn}`}
            >
              Back
            </button>
          )}
        </div>
      </div>
    );
  }

  if (screen === 'intro') {
    const dose = formatBrewAmount(dial.doseG);
    const yieldG = formatBrewAmount(dial.yieldG);
    return (
      <div className="space-y-4">
        <div className={`${ui.card} p-6 rounded-2xl space-y-5`}>
          <div className="space-y-2">
            <p className={ui.pageTitle}>Brew Guide</p>
            <h2 className={`text-2xl font-black tracking-tight ${ui.text}`}>Prepare this shot</h2>
            <p className={`text-sm leading-relaxed ${ui.sub}`}>
              One step at a time, using the coffee, recipe and grind setting already on Dial-In.
            </p>
          </div>

          {canStart ? (
            <div className={`${ui.cardInset} rounded-xl p-4 space-y-1`}>
              <p className={`text-sm font-bold ${ui.text}`}>{dial.beanName}</p>
              <p className={`text-lg font-black tabular-nums ${ui.text}`}>
                {dose}g in · {yieldG}g out · {dial.grindLabel}
              </p>
              <p className={`text-[11px] ${ui.sub}`}>
                {dial.grinderModel} · {dial.timeMinS}–{dial.timeMaxS}s
              </p>
            </div>
          ) : (
            <p className={`text-sm leading-relaxed ${ui.sub}`}>
              Choose a coffee on Dial-In first. Brew Guide uses that recipe and grind setting.
            </p>
          )}

          {canStart ? (
            <button
              type="button"
              onClick={start}
              className={`w-full min-h-[64px] rounded-xl text-base ${ui.primary}`}
            >
              Start
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenDial}
              className={`w-full min-h-[64px] rounded-xl text-base ${ui.primary}`}
            >
              Go to Dial-In
            </button>
          )}

          <button
            type="button"
            onClick={openSetup}
            className={`w-full min-h-[48px] rounded-xl text-sm font-bold ${ui.secondaryBtn}`}
          >
            Accessories
          </button>
        </div>
      </div>
    );
  }

  const StepIcon = STEP_ICONS[step.icon] || Coffee;
  const stepNumber = index + 1;

  return (
    <div className="flex flex-col gap-5 min-h-[calc(100dvh-16rem)]">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (index === 0) setScreen('intro');
              else setStepIndex(index - 1);
            }}
            className={`min-h-[44px] px-1 text-sm font-bold ${ui.accentText}`}
          >
            Back
          </button>
          <p className={`text-[10px] font-bold uppercase tracking-[0.18em] ${ui.muted}`} aria-live="polite">
            Step {stepNumber} of {steps.length}
          </p>
        </div>
        <div
          className={`h-1 w-full rounded-full overflow-hidden ${ui.progressTrack}`}
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={stepNumber}
          aria-label={`Step ${stepNumber} of ${steps.length}`}
        >
          <div className="h-full bg-[#c88a4b]" style={{ width: `${(stepNumber / steps.length) * 100}%` }} />
        </div>
      </div>

      <div className={`${ui.card} p-6 rounded-2xl space-y-4`}>
        <ToolMark icon={StepIcon} ui={ui} />
        <h2 className={`text-[1.75rem] leading-tight font-black tracking-tight ${ui.text}`}>{step.title}</h2>
        {step.highlight && (
          <div>
            {step.highlightLabel && <p className={`${ui.fieldLabel} mb-1`}>{step.highlightLabel}</p>}
            <p className={`text-5xl font-black font-mono tabular-nums leading-none ${ui.text}`}>{step.highlight}</p>
          </div>
        )}
        <p className={`text-base leading-relaxed ${ui.sub}`}>{step.instruction}</p>
        {step.note && <p className={`text-sm leading-relaxed ${ui.muted}`}>{step.note}</p>}
        {step.metrics && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {step.metrics.map((cell) => (
              <div key={cell.label} className={`${ui.cardInset} rounded-xl p-3 text-center`}>
                <p className={`text-[9px] uppercase tracking-wider ${ui.muted} mb-1`}>{cell.label}</p>
                <p className={`text-lg font-black tabular-nums ${ui.text}`}>{cell.value}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-auto">
        <button
          type="button"
          onClick={() => {
            if (index >= steps.length - 1) {
              setStepIndex(0);
              setScreen('intro');
              return;
            }
            setStepIndex(index + 1);
          }}
          className={`w-full min-h-[72px] rounded-[20px] text-base active:scale-[0.99] ${ui.primary}`}
        >
          Done
        </button>
      </div>
    </div>
  );
}
