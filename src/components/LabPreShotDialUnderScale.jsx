import { useShotLabPressureContext } from './ShotLabPressureContext.jsx';
import { PreShotDialStatus } from './PreShotDialStatus.jsx';
import { isPressureReplayBuild } from '../config/pressureReplayFlag.js';

/**
 * Dial-found line under Connect scale on the shot-ready card (fixture override for QA).
 */
export function LabPreShotDialUnderScale({ labEnabled, calibrated, timerRunning, ui }) {
  const ctx = useShotLabPressureContext();
  if (!labEnabled || !calibrated || timerRunning) return null;
  const override =
    (import.meta.env.DEV || isPressureReplayBuild()) && typeof window !== 'undefined'
      ? window.__preShotDialStatusOverride : null;
  const status = override ?? ctx?.preShotDialStatus ?? null;
  return <PreShotDialStatus status={status} ui={ui} cameraError={ctx?.cameraError} retryCamera={ctx?.retryCamera} />;
}
