/**
 * When the lab pressure readout should render on shot / weigh surfaces.
 * Camera warmup may still show a gap until samples arrive (non-sim).
 */
export function shotLabPressureReadoutVisible({
  enabled,
  displaySurfaceActive,
  calibrated,
  simMode,
}) {
  return Boolean(
    enabled && displaySurfaceActive && (calibrated || simMode),
  );
}

/**
 * Live samples are flowing (sim feed or camera stream ready).
 */
export function shotLabPressurePipelineLive({ simMode, cameraStatus }) {
  return simMode || cameraStatus === 'live';
}

export function shotLabPressureShowLive(args) {
  return (
    shotLabPressureReadoutVisible(args)
    && shotLabPressurePipelineLive(args)
  );
}
