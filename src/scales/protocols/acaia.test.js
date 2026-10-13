import assert from 'assert';
import { parseAcaiaWeightNotification } from './acaia.js';

export function runAcaiaProtocolTests() {
  const gen2 = new Uint8Array([0x05, 0x00, 0x00, 0x12, 0x34, 0x00, 0x00]);
  const parsedGen2 = parseAcaiaWeightNotification(gen2);
  assert.equal(parsedGen2.ok, true);
  assert.equal(parsedGen2.generation, 'gen2');
  assert.equal(parsedGen2.weightG, 46.6);

  const gen1 = new Uint8Array([0x0c, 0x00, 0x00, 0x01, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x00]);
  const parsedGen1 = parseAcaiaWeightNotification(gen1);
  assert.equal(parsedGen1.ok, true);
  assert.equal(parsedGen1.generation, 'gen1');
  assert.equal(parsedGen1.weightG, 30);

  console.log('Acaia protocol tests passed.');
}
