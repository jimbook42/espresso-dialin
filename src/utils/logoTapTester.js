/**
 * Passive multi-tap detector for header logo (test celebration trigger).
 * Does not block or delay individual tap handlers.
 */
export function createLogoTapTester({
  now = () => Date.now(),
  onTrigger,
  windowMs = 3000,
  taps = 7,
} = {}) {
  if (typeof onTrigger !== 'function') {
    throw new Error('createLogoTapTester requires onTrigger');
  }

  let firstTapAt = null;
  let count = 0;

  return {
    handleTap() {
      const t = now();
      if (firstTapAt === null || t - firstTapAt > windowMs) {
        firstTapAt = t;
        count = 1;
      } else {
        count += 1;
      }
      if (count >= taps) {
        firstTapAt = null;
        count = 0;
        onTrigger();
        return true;
      }
      return false;
    },
    /** @internal test helper */
    _getCount() {
      return count;
    },
  };
}

/** Alternates suit then gold for each completed 7-tap run (resets on reload). */
let logoTestCelebrationRun = 0;

export function nextLogoTestCelebrationVariant() {
  const variant = logoTestCelebrationRun % 2 === 0 ? 'suit' : 'gold';
  logoTestCelebrationRun += 1;
  return variant;
}

/** @internal vitest */
export function resetLogoTestCelebrationRun() {
  logoTestCelebrationRun = 0;
}
