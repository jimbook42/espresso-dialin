import assert from 'assert';
import {
  BREW_EXTRACT_ARMING,
  BREW_EXTRACT_IDLE,
  BREW_EXTRACT_RUNNING,
  syncBrewExtractPhaseWithTimer,
} from './brewGuideExtractPhase.js';

export function runBrewGuideExtractPhaseTests() {
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
