import assert from 'assert';
import {
  BOOKOO_COMMANDS,
  encodeBookooCommand,
  parseBookooWeightNotification,
} from './bookooMini.js';

export function runBookooMiniProtocolTests() {
  const tare = encodeBookooCommand(0x01);
  assert.deepEqual(Array.from(tare), [0x03, 0x0a, 0x01, 0x00, 0x00, 0x08]);

  const frame = new Uint8Array(20).fill(0);
  frame[0] = 0x03;
  frame[1] = 0x0b;
  frame[6] = 0x00;
  frame[7] = 0x00;
  frame[8] = 0x13;
  frame[9] = 0x88;
  frame[13] = 0x55;
  frame[19] = frame.slice(0, 19).reduce((a, b) => a ^ b, 0);

  const parsed = parseBookooWeightNotification(frame);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.weightG, 50);
  assert.equal(parsed.batteryPercent, 0x55);

  assert.ok(BOOKOO_COMMANDS.tareAndStart);

  console.log('Bookoo mini protocol tests passed.');
}
