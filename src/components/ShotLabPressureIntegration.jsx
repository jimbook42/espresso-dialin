import { useEffect, useState } from 'react';
import { shotLabPressureFitsViewport } from '../flairPressureLab/shotLabPressureLayout.js';
import {
  pressureLiveBorderClass,
  pressureLiveTextClass,
} from '../flairPressureLab/shotLabPressureTokens.js';
import { ShotLabPressureReadout } from './ShotLabPressureReadout.jsx';
import { useShotLabPressureContext } from './ShotLabPressureContext.jsx';

/**
 * Display-only surfaces for lab camera pressure (provider runs the reader once).
 */
export function ShotLabPressureIntegration({ variant, ui }) {
  const ctx = useShotLabPressureContext();
  const [viewportWidth, setViewportWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 390,
  );

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!ctx?.enabled) return null;
  if (!shotLabPressureFitsViewport(viewportWidth)) return null;

  if (variant === 'settings-hint') {
    return (
      <button
        type="button"
        onClick={ctx.openCalibrate}
        className={`text-[10px] font-semibold underline ${ui?.accentText ?? pressureLiveTextClass}`}
        data-testid="lab-gauge-calibrate-link"
      >
        {ctx.storedCalibration ? 'Re-run gauge setup (3 taps)' : 'Run gauge setup (3 taps)'}
      </button>
    );
  }

  return (
    <>
      {ctx.readoutVisible && (
        <ShotLabPressureReadout
          displayBar={ctx.displayBar}
          hold={ctx.hold}
          readerUncertain={ctx.readerUncertain}
          peakBar={ctx.peakBar}
          samples={ctx.samples}
          phaseGoal={ctx.phaseGoal}
          aimText={ctx.aimText}
          testingLabel={ctx.testingLabel}
          dialRecalibrateHint={ctx.dialRecalibrateHint}
          variant={variant === 'inline' ? 'inline' : variant === 'weighing' ? 'weighing' : 'fullscreen'}
          viewportWidth={viewportWidth}
          ui={ui}
        />
      )}
      {variant === 'inline' && !ctx.calibrated && !ctx.timerRunning && (
        <button
          type="button"
          onClick={ctx.openCalibrate}
          className={`mt-2 text-[10px] font-semibold min-h-[44px] px-3 rounded-lg border ${pressureLiveBorderClass} ${ui?.accentText ?? pressureLiveTextClass}`}
          data-testid="shot-lab-calibrate-cta"
        >
          Set up gauge (camera)
        </button>
      )}
    </>
  );
}
