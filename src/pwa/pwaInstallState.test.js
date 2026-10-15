import assert from 'assert';
import {
  isPwaInstallDismissalActive,
  PWA_INSTALL_DISMISS_TTL_MS,
  shouldOfferPwaInstallBanner,
} from './pwaInstallState.js';

export function runPwaInstallStateTests() {
  const now = Date.parse('2026-10-14T12:00:00.000Z');

  assert.equal(
    shouldOfferPwaInstallBanner({
      installed: true,
      dismissedAtMs: null,
      canPromptInstall: true,
      isIosSafari: false,
      nowMs: now,
    }),
    false
  );

  assert.equal(
    shouldOfferPwaInstallBanner({
      installed: false,
      dismissedAtMs: now - PWA_INSTALL_DISMISS_TTL_MS + 1000,
      canPromptInstall: true,
      isIosSafari: false,
      nowMs: now,
    }),
    false
  );

  assert.equal(
    shouldOfferPwaInstallBanner({
      installed: false,
      dismissedAtMs: now - PWA_INSTALL_DISMISS_TTL_MS - 1,
      canPromptInstall: true,
      isIosSafari: false,
      nowMs: now,
    }),
    true
  );

  assert.equal(
    shouldOfferPwaInstallBanner({
      installed: false,
      dismissedAtMs: null,
      canPromptInstall: false,
      isIosSafari: true,
      nowMs: now,
    }),
    true
  );

  assert.equal(isPwaInstallDismissalActive(now - 1000, now), true);
  console.log('PWA install state tests passed.');
}
