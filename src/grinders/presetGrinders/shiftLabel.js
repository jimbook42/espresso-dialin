import { adjustCustomGrind, parseCustomGrindValue } from '../customGrinder.js';

/**
 * Step count and direction for off-target quantitative recommendations (presets/custom).
 */
export function formatDialShiftReasonParts(grinderProfile, customGrindValue, shift) {
  const profile = grinderProfile?.customProfile;
  if (!profile || shift === 0) return null;
  const current = parseCustomGrindValue(customGrindValue, profile);
  if (current === null) return null;
  const next = adjustCustomGrind(current, shift, profile);
  const steps = Math.round(Math.abs(next - current) / profile.step);
  if (steps === 0) return null;
  const direction = next < current ? 'FINER' : 'COARSER';
  const unit = grinderProfile.timeOffTargetStepLabel || 'step(s)';
  return { steps, direction, unit };
}
