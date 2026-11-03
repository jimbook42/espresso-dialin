/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isShotScreenLayoutTest } from './shotScreenLayoutTest.js';

afterEach(() => {
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});

describe('shot screen layout calibration bypass', () => {
  it('requires both a development runtime and the explicit layout-test URL', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('PROD', false);
    expect(isShotScreenLayoutTest()).toBe(false);
    window.history.replaceState({}, '', '/?shotScreenTest=1');
    expect(isShotScreenLayoutTest()).toBe(true);
    window.history.replaceState({}, '', '/?shotScreenTest=0');
    expect(isShotScreenLayoutTest()).toBe(false);
  });

  it('cannot be enabled by the URL in a production build', () => {
    window.history.replaceState({}, '', '/?shotScreenTest=1');
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    expect(isShotScreenLayoutTest()).toBe(false);
    vi.stubEnv('DEV', true);
    expect(isShotScreenLayoutTest()).toBe(false);
  });
});
