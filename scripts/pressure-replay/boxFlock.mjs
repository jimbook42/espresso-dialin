/** BOX RULE: callers wrap scoring/tests in `flock -w 1200 /tmp/box-test.lock timeout 10m …` and set BOX_TEST_LOCK_HELD=1 to avoid nested deadlocks. */

export const BOX_TEST_LOCK = '/tmp/box-test.lock';
export const BOX_FLOCK_WAIT_S = process.env.BOX_FLOCK_WAIT || '1200';

export function boxTestLockHeld() {
  return process.env.BOX_TEST_LOCK_HELD === '1';
}

/** @returns {[string, string[]]} argv prefix for execFileSync / spawn when lock is not already held */
export function flockWrap(cmd, args = []) {
  if (boxTestLockHeld()) return [cmd, args];
  return ['flock', ['-w', BOX_FLOCK_WAIT_S, BOX_TEST_LOCK, cmd, ...args]];
}
