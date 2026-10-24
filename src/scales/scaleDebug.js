/** @type {Set<(lines: string[]) => void>} */
const listeners = new Set();

/** @type {string[]} */
let lines = [];

/**
 * @returns {boolean}
 */
export function isScaleDebugActive() {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get('scaleDebug') === '1';
  } catch {
    return false;
  }
}

/**
 * @param {string} line
 */
export function pushScaleDebugLine(line) {
  if (!isScaleDebugActive()) return;
  lines = [line, ...lines].slice(0, 8);
  for (const listener of listeners) {
    listener([...lines]);
  }
}

/**
 * @param {(next: string[]) => void} listener
 * @returns {() => void}
 */
export function subscribeScaleDebug(listener) {
  listeners.add(listener);
  listener([...lines]);
  return () => listeners.delete(listener);
}

/**
 * @param {{ opcode: number, cmdId: number }} detail
 */
/** @internal test helper */
export function resetScaleDebugForTests() {
  lines = [];
}

export function logUnknownTimemoreFrame(detail) {
  const label = `unknown Timemore frame opcode=0x${detail.opcode.toString(16)} cmdId=0x${detail.cmdId.toString(16)}`;
  console.debug(`[scale] ${label}`);
  pushScaleDebugLine(label);
}
