/** Preview-only simulated camera pressure (never on in production builds by default). */
export function isPressureSimAllowed() {
  return import.meta.env.VITE_PRESSURE_ALLOW_SIM === 'true';
}
