import {
  PRE_SHOT_DIAL_FOUND_LABEL,
  PRE_SHOT_DIAL_NOT_FOUND_LABEL,
} from '../flairPressureLab/preShotDialCheck.js';

/**
 * Pre-shot dial pose verdict (informational; does not block Start).
 * @param {{ status: 'checking' | 'found' | 'not_found' | null, ui?: { muted?: string } }} props
 */
export function PreShotDialStatus({ status, ui }) {
  if (!status || status === 'checking') return null;
  const found = status === 'found';
  return (
    <p
      className={`text-[10px] leading-snug ${
        found ? 'text-[#6d7a5c]' : 'text-amber-700/90'
      }`}
      data-testid="pre-shot-dial-status"
      data-dial-found={found ? 'true' : 'false'}
    >
      {found ? PRE_SHOT_DIAL_FOUND_LABEL : PRE_SHOT_DIAL_NOT_FOUND_LABEL}
    </p>
  );
}
