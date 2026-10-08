/** Deterministic wall clock for engine snapshot tests (no production dependency). */

let realDate = globalThis.Date;

/**
 * @param {string|number|Date} fixed
 */
export function installTestClock(fixed) {
  const fixedMs = new realDate(fixed).getTime();
  const fixedDate = new realDate(fixedMs);

  function MockDate(...args) {
    if (args.length === 0) {
      return new realDate(fixedMs);
    }
    return new realDate(...args);
  }
  MockDate.now = () => fixedMs;
  MockDate.parse = realDate.parse;
  MockDate.UTC = realDate.UTC;
  MockDate.prototype = realDate.prototype;

  globalThis.Date = MockDate;
  return { fixedMs, fixedDate };
}

export function uninstallTestClock() {
  if (realDate) {
    globalThis.Date = realDate;
  }
}

/** Capture native Date before any install (for module init). */
export function captureRealDate() {
  realDate = globalThis.Date;
}
