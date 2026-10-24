import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VIEWPORT_SCRIPT = path.join(ROOT, 'scripts/shot-lab-pressure-viewport.mjs');

describe('shot lab pressure viewport (playwright)', () => {
  it.skipIf(process.env.RUN_LAB_PRESSURE_VIEWPORT !== '1')(
    'screenshots and document.scrollHeight <= innerHeight at 360/390/412 widths',
    () => {
      execFileSync(process.execPath, [VIEWPORT_SCRIPT], {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          SKIP_LAB_PRESSURE_VIEWPORT: undefined,
        },
      });
      expect(true).toBe(true);
    },
    300_000,
  );
});
