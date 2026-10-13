import assert from 'assert';
import { buildGenericMachineGuides } from './generic.js';

export function runGenericMachineGuideTests() {
  const guides = buildGenericMachineGuides();
  const allText = Object.values(guides).map((g) => g.steps.map((s) => s.instruction).join(' ')).join('\n');
  assert.doesNotMatch(allText, /Sunbeam|EM5300|ONE CUP|MANUAL SHOT/i);
  assert.match(allText, /espresso machine/i);
  console.log('Generic machine guide tests passed.');
}
