import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CORNER_PREVIEW_BOX } from '../flairPressureLab/labPressureCornerPreview.js';

const CONTEXT_SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'ShotLabPressureContext.jsx',
);

describe('shot lab corner preview shell', () => {
  it('clips inside a fixed 80×112 wrapper; crop styles come from the hook on the video', () => {
    const src = readFileSync(CONTEXT_SRC, 'utf8');
    expect(src).toContain('data-testid="lab-pressure-corner-preview"');
    expect(src).toMatch(/w-20 h-28|h-28 w-20/);
    expect(src).toContain('overflow-hidden');
    expect(src).not.toMatch(/data-testid="lab-pressure-corner-preview"[\s\S]*?style=\{cornerPreviewStyle\}/);
    expect(src).toContain('absolute inset-0 h-full w-full object-cover');
    expect(CORNER_PREVIEW_BOX.w).toBe(80);
    expect(CORNER_PREVIEW_BOX.h).toBe(112);
  });
});
