import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOK = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'hooks/useShotLabPressure.js',
);

describe('shot lab pressure sim interval stability', () => {
  it('does not re-subscribe the sim/camera loop on every timer tick', () => {
    const source = readFileSync(HOOK, 'utf8');
    expect(source).toContain('timerSecondsRef');
    const effectBlock = source.slice(source.indexOf('if (simMode)'));
    const depArray = source.slice(source.lastIndexOf('}, ['), source.lastIndexOf(']);') + 3);
    expect(depArray).not.toContain('timerSeconds');
  });
});
