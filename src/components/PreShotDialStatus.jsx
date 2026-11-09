import { preShotDialStatusView } from '../flairPressureLab/preShotReadableStatus.js';

/**
 * Pre-shot dial verdict (informational; does not block Start).
 * Green requires the pose lock and a recent confident reading.
 */
export function PreShotDialStatus({ status, cameraError, retryCamera }) {
  const view = preShotDialStatusView(status);
  if (view.tone === 'hidden') return null;
  const found = view.tone === 'green';
  return (
    <div
      className={`text-[10px] leading-snug ${
        found ? 'text-[#6d7a5c]' : 'text-amber-700/90'
      }`}
      data-testid="pre-shot-dial-status"
      data-dial-found={found ? 'true' : 'false'}
    >
      <span role="status">{status === 'unavailable' && cameraError ? cameraError : view.label}</span>
      {['unavailable', 'interrupted'].includes(status) && retryCamera && (
        <button type="button" onClick={retryCamera} className="ml-2 min-h-9 underline">Retry camera</button>
      )}
    </div>
  );
}
