import { describe, expect, it, beforeEach } from 'vitest';
import {
  getOpenCvSync,
  isOpenCvReady,
  loadOpenCv,
  resetOpenCvForTests,
} from './opencvRuntime.js';

describe('opencv runtime loader', () => {
  beforeEach(() => {
    resetOpenCvForTests();
  });

  it('starts unloaded in node (no document)', () => {
    expect(isOpenCvReady()).toBe(false);
    expect(getOpenCvSync()).toBeNull();
  });

  it('rejects loadOpenCv without a browser document', async () => {
    await expect(loadOpenCv()).rejects.toThrow(/browser document/i);
  });
});
