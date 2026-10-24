import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  shotTimerLabCompactActive,
  shotTimerLabCompactClass,
} from './shotTimerCompactLayout.js';

describe('shotTimerLabCompactClass', () => {
  it('is inactive when lab camera pressure is off', () => {
    expect(shotTimerLabCompactActive(false)).toBe(false);
    expect(shotTimerLabCompactClass(false)).toBe('');
  });

  it('adds compact class only when lab is on', () => {
    expect(shotTimerLabCompactActive(true)).toBe(true);
    expect(shotTimerLabCompactClass(true)).toBe('shot-timer-lab-compact');
  });

  it('scopes compact CSS to lab-on class only', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
    const css = readFileSync(path.join(root, 'index.css'), 'utf8');
    const block = css.match(/@media \(max-height: 700px\)[\s\S]*?\n\}/)?.[0] ?? '';
    expect(block).toContain('.shot-timer-fullscreen.shot-timer-lab-compact');
    expect(block).not.toMatch(/\.shot-timer-fullscreen \.shot-timer-/);
  });
});
