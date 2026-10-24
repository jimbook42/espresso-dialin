import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readWeighingTargetFeedbackSession,
  writeWeighingTargetFeedbackSession,
} from './weighingViewSession.js';

describe('weighingViewSession', () => {
  /** @type {Map<string, string>} */
  let store;

  beforeEach(() => {
    store = new Map();
    vi.stubGlobal('sessionStorage', {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => store.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to enabled and persists toggle', () => {
    expect(readWeighingTargetFeedbackSession()).toBe(true);
    writeWeighingTargetFeedbackSession(false);
    expect(readWeighingTargetFeedbackSession()).toBe(false);
    writeWeighingTargetFeedbackSession(true);
    expect(readWeighingTargetFeedbackSession()).toBe(true);
  });
});
