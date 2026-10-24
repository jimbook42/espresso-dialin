/** True only in harness preview builds (VITE_PRESSURE_REPLAY=true). Stripped/inert in default production builds. */
export function isPressureReplayFromEnv(raw) {
  return raw === 'true';
}

export function isPressureReplayBuild() {
  return isPressureReplayFromEnv(import.meta.env.VITE_PRESSURE_REPLAY);
}
