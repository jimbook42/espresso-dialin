/** @param {number} g */
export function formatScaleLiveWeightLabel(g) {
  const n = Number(g);
  if (!Number.isFinite(n)) return '0.0 g';
  return `${n.toFixed(1)} g`;
}

/**
 * Compact scale connect / transport controls for the live shot timer card.
 */
export function ScaleTimerControls({
  ui,
  simAllowed,
  bleAvailable,
  transportKind,
  onTransportKindChange,
  connectStatus,
  isConnected,
  liveWeightG = 0,
  onConnect,
  onDisconnect,
  onTare,
}) {
  const canConnect = simAllowed || bleAvailable;
  if (!canConnect) {
    return (
      <p className={`text-[9px] ${ui.muted}`}>Web Bluetooth unavailable — use preview sim env if needed.</p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {simAllowed && !isConnected && (
        <select
          value={transportKind}
          disabled={connectStatus === 'connecting'}
          onChange={(e) => onTransportKindChange(e.target.value)}
          className={`${ui.chip} text-[10px] rounded-lg px-2 py-1 max-w-[120px]`}
          aria-label="Scale transport"
        >
          <option value="sim">Simulated</option>
          <option value="ble" disabled={!bleAvailable}>Bluetooth</option>
        </select>
      )}
      {!isConnected ? (
        <button
          type="button"
          onClick={onConnect}
          disabled={connectStatus === 'connecting' || (transportKind === 'ble' && !bleAvailable)}
          className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-[rgba(200,138,75,0.15)] text-[#c88a4b] border border-[rgba(200,138,75,0.3)] disabled:opacity-40"
        >
          {connectStatus === 'connecting' ? 'Connecting…' : 'Connect scale'}
        </button>
      ) : (
        <>
          <span className="text-[10px] font-semibold text-[#8a9d72]">Scale on</span>
          <span
            className={`text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-lg ${ui.chip} ${ui.text}`}
            role="status"
            aria-live="off"
            aria-label={`Scale weight ${formatScaleLiveWeightLabel(liveWeightG)}`}
          >
            {formatScaleLiveWeightLabel(liveWeightG)}
          </span>
          <button
            type="button"
            onClick={onTare}
            className={`text-[10px] font-bold px-2 py-1 rounded-lg ${ui.chip} ${ui.muted}`}
          >
            Tare
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            className={`text-[10px] font-bold px-2 py-1 rounded-lg ${ui.chip} ${ui.muted}`}
          >
            Disconnect
          </button>
        </>
      )}
      {connectStatus === 'error' && (
        <span className="text-[9px] text-rose-400">Connect failed</span>
      )}
    </div>
  );
}
