import assert from 'assert';
import {
  BREW_EXTRACT_ARMING,
  BREW_EXTRACT_IDLE,
  BREW_EXTRACT_RUNNING,
  syncBrewExtractPhaseWithTimer,
} from './brewGuideExtractPhase.js';

export function runBrewGuideExtractPhaseTests() {
  let phase = BREW_EXTRACT_ARMING;
  phase = syncBrewExtractPhaseWithTimer(phase, {
    timerRunning: false,
    countdownActive: true,
  });
  assert.equal(phase, BREW_EXTRACT_ARMING, 'countdown completing must not drop to idle before handoff');

  phase = syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
    timerRunning: false,
    countdownActive: false,
    startPending: true,
  });
  assert.equal(phase, BREW_EXTRACT_ARMING);

  phase = syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
    timerRunning: true,
    countdownActive: false,
  });
  assert.equal(phase, BREW_EXTRACT_RUNNING, 'countdown complete must enter running timer');

  phase = syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
    timerRunning: false,
    countdownActive: false,
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
      startPending: true,
    }),
    BREW_EXTRACT_ARMING
  );
  assert.equal(
    syncBrewExtractPhaseWithTimer(BREW_EXTRACT_ARMING, {
      timerRunning: true,
      countdownActive: false,
      startPending: true,
    }),
    BREW_EXTRACT_RUNNING
  );
  assert.equal(
    syncBrewExtractPhaseWithTimer(BREW_EXTRACT_RUNNING, { timerRunning: false, countdownActive: false }),
    BREW_EXTRACT_RUNNING
  );
  console.log('Brew Guide extract phase tests passed.');
}
