import assert from 'assert';
import {
  CENTER_TICK,
  computeTickStripTranslate,
  computeTickWindow,
} from './grindControlsTickStrip.js';
import { NICHE_ZERO_DIAL_MAX } from '../grinders/nicheZero.js';

export function runGrindControlsTests() {
  const nicheMaxIndex = NICHE_ZERO_DIAL_MAX * 10;
  const spacing = 40;

  const at152 = computeTickWindow(152, nicheMaxIndex);
  assert.equal(at152.start <= 152 && at152.end >= 152, true);
  assert.equal(
    computeTickStripTranslate(152, at152.start, spacing, 0),
    CENTER_TICK * spacing - (152 - at152.start) * spacing
  );

  const atZero = computeTickWindow(0, nicheMaxIndex);
  assert.equal(atZero.start, 0);
  assert.equal(computeTickStripTranslate(0, 0, spacing, 0), CENTER_TICK * spacing);

  const atMax = computeTickWindow(nicheMaxIndex, nicheMaxIndex);
  assert.equal(atMax.end, nicheMaxIndex);
  assert.equal(
    computeTickStripTranslate(nicheMaxIndex, atMax.start, spacing, 0),
    CENTER_TICK * spacing - (nicheMaxIndex - atMax.start) * spacing
  );

  console.log('Grind controls tick strip tests passed.');
}
