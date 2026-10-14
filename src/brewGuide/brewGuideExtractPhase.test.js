import assert from 'assert';
import {
  BREW_EXTRACT_ARMING,
  BREW_EXTRACT_IDLE,
  BREW_EXTRACT_RUNNING,
  isBrewGuideExtractCountdownActive,
  syncBrewExtractPhaseWithTimer,
} from './brewGuideExtractPhase.js';

export function runBrewGuideExtractPhaseTests() {
  assert.equal(
    isBrewGuideExtractCountdownActive({ shotCountdownValue: 0, countdownHandoffPending: false }),
    true,
    'transient 0 tick must still count as countdown active for Brew Guide'
  );
  assert.equal(isBrewGuideExtractCountdownActive({ shotCountdownValue: null, countdownHandoffPending: true }), true);
  assert.equal(isBrewGuideExtractCountdownActive({ shotCountdownValue: null, countdownHandoffPending: false }), false);

  let phase = BREW_EXTRACT_ARMING;
  phase = syncBrewExtractPhaseWithTimer(phase, {
    timerRunning: false,
    countdownActive: isBrewGuideExtractCountdownActive({ shotCountdownValue: 0, countdownHandoffPending: false }),
    countdownHandoffPending: false,
  });
  assert.equal(phase, BREW_EXTRACT_ARMING, 'countdown completing must not drop to idle before handoff');

  phase = syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
    timerRunning: false,
    countdownActive: isBrewGuideExtractCountdownActive({ shotCountdownValue: null, countdownHandoffPending: true }),
    countdownHandoffPending: true,
  });
  assert.equal(phase, BREW_EXTRACT_ARMING);

  phase = syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
    timerRunning: true,
    countdownActive: false,
    countdownHandoffPending: false,
  });
  assert.equal(phase, BREW_EXTRACT_RUNNING, 'countdown complete must enter running timer');

  phase = syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
    timerRunning: false,
    countdownActive: false,
    countdownHandoffPending: false,
  });
  assert.equal(phase, BREW_EXTRACT_IDLE, 'cancel countdown leaves clean idle (Start again from 0)');

  assert.equal(
    syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, { timerRunning: true, countdownActive: false }),
    BREW_EXTRACT_RUNNING
  );
  assert.equal(
    syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, { timerRunning: false, countdownActive: true }),
    BREW_EXTRACT_ARMING
  );
  assert.equal(
    syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, { timerRunning: false, countdownActive: false }),
    BREW_EXTRACT_IDLE
  );
  assert.equal(
    syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
      timerRunning: false,
      countdownActive: false,
      countdownHandoffPending: true,
    }),
    BREW_EXTRACT_ARMING
  );
  assert.equal(
    syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
      timerRunning: true,
      countdownActive: false,
      countdownHandoffPending: true,
    }),
    BREW_EXTRACT_RUNNING
  );
  assert.equal(
    syncBrewExtractPhaseWithTimer(BREW_EXTRACT_RUNNING, { timerRunning: false, countdownActive: false }),
    BREW_EXTRACT_RUNNING
  );
  console.log('Brew Guide extract phase tests passed.');
}
