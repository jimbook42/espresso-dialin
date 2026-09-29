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
  Play,
  Power,
  RotateCcw,
  Scale,
  Timer,
  Trash2,
} from 'lucide-react';
import { SettingsToggle } from './SettingsToggle';
import {
  BREW_ACCESSORIES,
  brewDialIsReady,
  brewDialSummary,
  buildBrewSteps,
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
  power: Power,
  water: Droplets,
  cup: Coffee,
  empty: CupSoda,
  dry: Coffee,
  portafilter: Disc,
  grind: Bean,
  purge: RotateCcw,
  discard: Trash2,
  weigh: Scale,
  rdt: Droplets,
  load: ArrowDown,
  shake: FlaskConical,
  transfer: ArrowDown,
  wdt: Pin,
  funnel: Funnel,
  distribute: CircleDot,
  tamp: ArrowDownToLine,
  screen: Disc,
  preheat: Coffee,
  timer: Timer,
  rinse: Droplets,
  ready: Coffee,
  log: ClipboardList,
};

function ToolMark({ icon: Icon, ui }) {
  return (
    <div className={`${ui.cardInset} w-14 h-14 rounded-2xl flex items-center justify-center shrink-0`}>
      <Icon className={`w-7 h-7 ${ui.accentText}`} aria-hidden />
    </div>
  );
}

function StepHelp({ help, ui }) {
  const [open, setOpen] = useState(false);
  if (!help) return null;
  return (
    <div data-timer-dismiss>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`min-h-[44px] text-sm font-bold ${ui.accentText}`}
        aria-expanded={open}
      >
        {open ? 'Hide help' : 'Help'}
      </button>
      {open && <p className={`text-sm leading-relaxed ${ui.sub}`}>{help}</p>}
    </div>
  );
}

function MetricGrid({ metrics, ui }) {
  if (!metrics?.length) return null;
  return (
    <div className="grid grid-cols-2 gap-2 pt-1">
      {metrics.map((cell) => (
        <div key={cell.label} className={`${ui.cardInset} rounded-xl p-3 text-center`}>
          <p className={`text-[9px] uppercase tracking-wider ${ui.muted} mb-1`}>{cell.label}</p>
          <p className={`text-base font-black tabular-nums break-words ${ui.text}`}>{cell.value}</p>
        </div>
      ))}
    </div>
  );
}

export function BrewGuide({
  ui,
  accessories,
  setupComplete,
  onSaveAccessories,
  onOpenDial,
  onOpenBeans,
  hasActiveBean = true,
  dial,
  timer = { running: false, label: '0:00.0', usePreInfusion: false, preInfusionPhase: false },
  onStartTimer = () => {},
  onStopTimer = () => null,
  onResetTimer = () => {},
  onEndPreInfusion = () => {},
  onHandoff = () => {},
  onTimerHost = () => {},
}) {
  const [screen, setScreen] = useState(setupComplete ? 'intro' : 'setup');
  const [draft, setDraft] = useState(() => normalizeBrewAccessories(accessories));
  const [stepIndex, setStepIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [extractPhase, setExtractPhase] = useState('idle');
  const [capturedTime, setCapturedTime] = useState(null);

  const steps = buildBrewSteps(accessories, dial);
  const index = Math.min(stepIndex, Math.max(steps.length - 1, 0));
  const step = steps[index];
  const canStart = brewDialIsReady(dial);
  const summary = brewDialSummary(dial);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [screen, index]);

  useEffect(() => {
    const hosting = screen === 'steps' && step?.kind === 'timer';
    onTimerHost(hosting);
    return () => onTimerHost(false);
  }, [screen, step?.kind, onTimerHost]);

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
    onResetTimer();
    setCapturedTime(null);
    setExtractPhase('idle');
    setStepIndex(0);
    setScreen('steps');
  };

  const finishTimer = () => {
    const rounded = onStopTimer();
    setCapturedTime(rounded);
    setExtractPhase('stopped');
  };

  const resetExtract = () => {
    onResetTimer();
    setCapturedTime(null);
    setExtractPhase('idle');
  };

  const handleTimerSurface = (event) => {
    if (event.target.closest('[data-timer-dismiss]')) return;
    if (step?.kind !== 'timer') return;
    if (extractPhase === 'running') {
      if (timer.usePreInfusion && timer.preInfusionPhase) {
        onEndPreInfusion();
        return;
      }
      setExtractPhase('finishing');
      return;
    }
    if (extractPhase === 'finishing') finishTimer();
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

        <div className="space-y-2 pt-1 pb-16">
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
            <MetricGrid metrics={summary.metrics} ui={ui} />
          ) : (
            <p className={`text-sm leading-relaxed ${ui.sub}`}>
              {hasActiveBean
                ? 'Choose a coffee on Dial-In first. Brew Guide uses that recipe and grind setting.'
                : 'No active coffee bean profiles.'}
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
              onClick={hasActiveBean ? onOpenDial : (onOpenBeans || onOpenDial)}
              className={`w-full min-h-[64px] rounded-xl text-base ${ui.primary}`}
            >
              {hasActiveBean ? 'Go to Dial-In' : 'Add your first bean'}
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
  const timerLive = extractPhase === 'running' || extractPhase === 'finishing';
  const doneDisabled = (step.kind === 'timer' && extractPhase !== 'stopped')
    || (step.kind === 'handoff' && capturedTime == null);

  const goBack = () => {
    if (step.kind === 'timer' && timerLive) resetExtract();
    if (index === 0) setScreen('intro');
    else setStepIndex(index - 1);
  };

  const goDone = () => {
    if (doneDisabled) return;
    if (step.kind === 'handoff') {
      const timeS = capturedTime;
      setCapturedTime(null);
      setExtractPhase('idle');
      setStepIndex(0);
      setScreen('intro');
      onHandoff(timeS);
      return;
    }
    if (index >= steps.length - 1) {
      setStepIndex(0);
      setScreen('intro');
      return;
    }
    setStepIndex(index + 1);
  };

  let timerHint = 'Start the timer when you start the shot.';
  if (extractPhase === 'running' && timer.usePreInfusion && timer.preInfusionPhase) {
    timerHint = 'Tap anywhere to end pre-infusion.';
  } else if (extractPhase === 'running') {
    timerHint = 'Tap anywhere when you stop the machine.';
  } else if (extractPhase === 'finishing') {
    timerHint = `Let the rest of the espresso finish flowing until you reach ${step.highlight}, then take the cup off the scale. Tap anywhere to stop the timer.`;
  } else if (extractPhase === 'stopped') {
    timerHint = 'Take the cup off the scale if it is still there. The shot time is ready for Dial-In.';
  }

  return (
    <div className="flex flex-col gap-5 pb-44">
      <div className="space-y-3" data-timer-dismiss>
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goBack}
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

      <div
        className={`${ui.card} ${step.kind === 'timer' ? 'p-4 space-y-3' : 'p-6 space-y-4'} rounded-2xl ${timerLive ? 'cursor-pointer' : ''}`}
        onClick={timerLive ? handleTimerSurface : undefined}
        role={timerLive ? 'presentation' : undefined}
      >
        {step.kind !== 'timer' && <ToolMark icon={StepIcon} ui={ui} />}
        <h2 className={`text-[1.75rem] leading-tight font-black tracking-tight ${ui.text}`}>{step.title}</h2>

        {step.kind === 'timer' ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className={`${ui.cardInset} rounded-xl p-3 text-center`}>
                <p className={`text-[9px] uppercase tracking-wider ${ui.muted} mb-1`}>Target yield</p>
                <p className={`text-2xl font-black tabular-nums ${ui.text}`}>{step.highlight}</p>
              </div>
              <div className={`${ui.cardInset} rounded-xl p-3 text-center`}>
                <p className={`text-[9px] uppercase tracking-wider ${ui.muted} mb-1`}>
                  {step.stopAt ? 'Stop around' : 'Time'}
                </p>
                <p className={`text-2xl font-black tabular-nums ${ui.text}`}>
                  {step.stopAt ? `${step.stopAt}g` : step.timeLabel}
                </p>
              </div>
            </div>
            {step.stopAt && (
              <p className={`text-center text-sm ${ui.sub}`}>Aim for {step.timeLabel}</p>
            )}
            <p
              className={`text-center text-[clamp(2.75rem,14vw,3.75rem)] font-black font-mono tabular-nums leading-none ${ui.text}`}
              aria-live="polite"
            >
              {extractPhase === 'stopped' && capturedTime != null ? `${capturedTime}s` : (extractPhase === 'idle' ? '0:00.0' : timer.label)}
            </p>
            <p className={`text-base leading-relaxed text-center ${ui.sub}`}>{timerHint}</p>
            {step.note && <p className={`text-sm leading-relaxed text-center ${ui.muted}`}>{step.note}</p>}
            <StepHelp key={step.id} help={step.help} ui={ui} />
            <div data-timer-dismiss>
              {extractPhase === 'idle' && (
                <button
                  type="button"
                  onClick={() => {
                    setCapturedTime(null);
                    setExtractPhase('running');
                    onStartTimer();
                  }}
                  className={`w-full min-h-[64px] rounded-[20px] text-base flex items-center justify-center gap-2 ${ui.primary}`}
                >
                  <Play className="w-5 h-5 fill-current" aria-hidden />
                  Start timer
                </button>
              )}
              {extractPhase === 'running' && (
                <button
                  type="button"
                  onClick={() => {
                    if (timer.usePreInfusion && timer.preInfusionPhase) onEndPreInfusion();
                    else setExtractPhase('finishing');
                  }}
                  className={`w-full min-h-[64px] rounded-[20px] text-base ${ui.primary}`}
                >
                  {timer.usePreInfusion && timer.preInfusionPhase ? 'End pre-infusion' : 'Machine stopped'}
                </button>
              )}
              {extractPhase === 'finishing' && (
                <button
                  type="button"
                  onClick={finishTimer}
                  className={`w-full min-h-[64px] rounded-[20px] text-base ${ui.primary}`}
                >
                  Stop timer
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {step.highlight && (
              <div>
                {step.highlightLabel && <p className={`${ui.fieldLabel} mb-1`}>{step.highlightLabel}</p>}
                <p className={`text-5xl font-black font-mono tabular-nums leading-none ${ui.text}`}>{step.highlight}</p>
              </div>
            )}
            <p className={`text-base leading-relaxed ${ui.sub}`}>{step.instruction}</p>
            {step.note && <p className={`text-sm leading-relaxed ${ui.muted}`}>{step.note}</p>}
            <StepHelp key={step.id} help={step.help} ui={ui} />
            <MetricGrid metrics={step.metrics} ui={ui} />
          </>
        )}
      </div>

      <div className={`fixed bottom-[4.25rem] left-0 right-0 p-3 z-40 ${ui.dock} backdrop-blur`} data-timer-dismiss>
        <div className="max-w-xl mx-auto space-y-2">
          {step.kind === 'timer' && extractPhase !== 'idle' && (
            <button
              type="button"
              onClick={resetExtract}
              className={`w-full min-h-[44px] rounded-xl text-sm font-bold flex items-center justify-center gap-2 ${ui.secondaryBtn}`}
            >
              <RotateCcw className="w-4 h-4" aria-hidden />
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={goDone}
            disabled={doneDisabled}
            className={`w-full min-h-[64px] rounded-[20px] text-base active:scale-[0.99] ${ui.primary} disabled:opacity-40`}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
