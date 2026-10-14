import assert from 'assert';
import {
  DEFAULT_SHOT_START_COUNTDOWN,
  isShotStartCountdownActive,
  normalizeShotStartCountdown,
  SHOT_START_COUNTDOWN_FLAIR_ONLY,
  SHOT_START_COUNTDOWN_OFF,
  SHOT_START_COUNTDOWN_ON,
} from './shotStartCountdown.js';

export function runShotStartCountdownTests() {
  assert.equal(DEFAULT_SHOT_START_COUNTDOWN, SHOT_START_COUNTDOWN_FLAIR_ONLY);
  assert.equal(normalizeShotStartCountdown(undefined), SHOT_START_COUNTDOWN_FLAIR_ONLY);
  assert.equal(normalizeShotStartCountdown('bogus'), SHOT_START_COUNTDOWN_FLAIR_ONLY);
  assert.equal(isShotStartCountdownActive(SHOT_START_COUNTDOWN_OFF, true), false);
  assert.equal(isShotStartCountdownActive(SHOT_START_COUNTDOWN_ON, false), true);
  assert.equal(isShotStartCountdownActive(SHOT_START_COUNTDOWN_FLAIR_ONLY, true), true);
  assert.equal(isShotStartCountdownActive(SHOT_START_COUNTDOWN_FLAIR_ONLY, false), false);
  console.log('Shot start countdown tests passed.');
}
