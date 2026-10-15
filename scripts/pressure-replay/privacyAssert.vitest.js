import { describe, expect, it } from 'vitest';
import { assessPressureLabPrivacy } from './privacyAssert.js';

describe('pressure lab privacy assert', () => {
  it('passes when only same-origin static assets load', () => {
    const origin = 'http://127.0.0.1:4176';
    const result = assessPressureLabPrivacy(
      [
        { url: `${origin}/assets/index.js`, method: 'GET', postBytes: 0 },
        { url: `${origin}/assets/opencv.js`, method: 'GET', postBytes: 0 },
      ],
      { localStorageWrites: 0, indexedDbWrites: 0 },
      origin,
    );
    expect(result.passed).toBe(true);
  });

  it('fails on external posts or storage writes', () => {
    const origin = 'http://127.0.0.1:4176';
    const ext = assessPressureLabPrivacy(
      [{ url: 'https://example.com/upload', method: 'POST', postBytes: 120_000 }],
      { localStorageWrites: 0, indexedDbWrites: 0 },
      origin,
    );
    expect(ext.passed).toBe(false);
    const store = assessPressureLabPrivacy([], { localStorageWrites: 2, indexedDbWrites: 0 }, origin);
    expect(store.passed).toBe(false);
  });
});
