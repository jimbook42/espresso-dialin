import { preShotDialStatusView } from '../flairPressureLab/preShotReadableStatus.js';

/**
 * Pre-shot dial verdict (informational; does not block Start).
 * Green requires the pose lock and a recent confident reading.
 * @param {{ status: 'checking' | 'found' | 'not_found' | 'unreadable' | null }} props
 */
export function PreShotDialStatus({ status }) {
  const view = preShotDialStatusView(status);
  if (view.tone === 'hidden') return null;
  const found = view.tone === 'green';
  return (
    <p
      className={`text-[10px] leading-snug ${
        found ? 'text-[#6d7a5c]' : 'text-amber-700/90'
      }`}
      data-testid="pre-shot-dial-status"
      data-dial-found={found ? 'true' : 'false'}
    >
      {view.label}
    </p>
  );
}
