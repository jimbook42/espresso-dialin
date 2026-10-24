import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { pressureLiveStroke, pressureLiveTextClass } from './shotLabPressureTokens.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('shot lab pressure colours', () => {
  it('uses terracotta tokens, not legacy blue (#7eb8da)', () => {
    expect(pressureLiveStroke).toBe('#c97868');
    expect(pressureLiveTextClass).toContain('#c97868');
    expect(pressureLiveStroke).not.toBe('#7eb8da');
  });

  it('pressure UI source files avoid blue pressure accents', () => {
    const files = [
      'components/ShotLabPressureReadout.jsx',
      'components/ShotPressureChart.jsx',
      'components/ShotLabPressureIntegration.jsx',
    ];
    for (const rel of files) {
      const text = readFileSync(path.join(root, rel), 'utf8');
      expect(text).not.toMatch(/#7eb8da/);
      expect(text).not.toMatch(/\btext-blue-/);
      expect(text).not.toMatch(/\bborder-blue-/);
    }
  });
});
