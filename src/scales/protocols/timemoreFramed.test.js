import assert from 'assert';
import {
  TIMEMORE_COMMAND_FRAMES,
  crc16Modbus,
  encodeTimemoreFrame,
  hexToBytes,
  parseTimemoreNotification,
  readInt32BeTenthsGram,
} from './timemoreFramed.js';

function bytesToHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function runTimemoreFramedTests() {
  assert.equal(crc16Modbus(hexToBytes('a5 5a 03 0d 00 00')).toString(16), '64d1');

  const expectedFrames = {
    tare: 'a5 5a 03 0d 00 00 64 d1',
    timerStart: 'a5 5a 03 02 00 01 01 18 67',
    timerStop: 'a5 5a 03 02 00 01 02 19 27',
    timerReset: 'a5 5a 03 02 00 01 03 d9 e6',
    unitGrams: 'a5 5a 03 06 00 01 00 e8 a7',
    modeStandard: 'a5 5a 03 08 00 02 01 00 eb 31',
  };

  for (const key of Object.keys(expectedFrames)) {
    assert.equal(bytesToHex(TIMEMORE_COMMAND_FRAMES[key]), expectedFrames[key]);
  }

  const built = encodeTimemoreFrame(0x03, 0x0d);
  assert.equal(bytesToHex(built), expectedFrames.tare);

  const weightPayload = new Uint8Array([0x00, 0x00, 0x00, 0xb4]); // 18.0 g
  assert.equal(readInt32BeTenthsGram(weightPayload, 0), 18);

  const negative = new Uint8Array([0xff, 0xff, 0xff, 0xf6]); // -1.0 g
  assert.equal(readInt32BeTenthsGram(negative, 0), -1);

  const weightNotify = hexToBytes(
    'a5 5a 01 01 00 08 00 00 00 b4 00 00 00 00 1b f8'
  );

  const events = parseTimemoreNotification(weightNotify);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'weight');
  assert.equal(events[0].weightG, 18);
  assert.equal(events[0].crcOk, true);

  const concat = new Uint8Array([0x00, 0x00, ...weightNotify, 0xff]);
  const multi = parseTimemoreNotification(concat);
  assert.equal(multi.length, 1);
  assert.equal(multi[0].weightG, 18);

  let crcFailures = 0;
  const badCrc = new Uint8Array(weightNotify);
  badCrc[badCrc.length - 1] ^= 0xff;
  parseTimemoreNotification(badCrc, {
    onCrcFailure: () => {
      crcFailures += 1;
    },
  });
  assert.equal(crcFailures, 1);

  console.log('Timemore framed protocol tests passed.');
}
