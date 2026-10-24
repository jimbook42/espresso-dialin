/**
 * Timemore Black Mirror Dot / Basic 3 framed BLE protocol (service 0xFFF0).
 * Pure encode/decode — no transport dependencies.
 */

export const TIMEMORE_DOT_SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
export const TIMEMORE_DOT_NOTIFY_UUID = '0000fff1-0000-1000-8000-00805f9b34fb';
export const TIMEMORE_DOT_WRITE_UUID = '0000fff2-0000-1000-8000-00805f9b34fb';

const FRAME_HEADER = 0xa5;
const FRAME_HEADER2 = 0x5a;

/** @typedef {'weight' | 'battery' | 'unknown'} TimemoreNotificationKind */

/**
 * @typedef {Object} TimemoreParsedEvent
 * @property {TimemoreNotificationKind} kind
 * @property {number} [weightG]
 * @property {number} [batteryPercent]
 * @property {number} opcode
 * @property {number} cmdId
 * @property {boolean} crcOk
 */

/**
 * CRC-16/MODBUS over header..data (init 0xFFFF, poly 0xA001 reflected).
 * @param {Uint8Array} data
 */
export function crc16Modbus(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) crc = (crc >> 1) ^ 0xa001;
      else crc >>= 1;
    }
  }
  return crc;
}

/**
 * @param {number} opcode
 * @param {number} cmdId
 * @param {Uint8Array | number[]} [payload]
 */
export function encodeTimemoreFrame(opcode, cmdId, payload = []) {
  const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const len = data.length;
  const body = new Uint8Array(6 + len);
  body[0] = FRAME_HEADER;
  body[1] = FRAME_HEADER2;
  body[2] = opcode & 0xff;
  body[3] = cmdId & 0xff;
  body[4] = (len >> 8) & 0xff;
  body[5] = len & 0xff;
  body.set(data, 6);
  const crc = crc16Modbus(body);
  const frame = new Uint8Array(body.length + 2);
  frame.set(body);
  frame[body.length] = (crc >> 8) & 0xff;
  frame[body.length + 1] = crc & 0xff;
  return frame;
}

/** Pre-built command frames from protocol research (Beanconqueror). */
export const TIMEMORE_COMMAND_FRAMES = Object.freeze({
  tare: encodeTimemoreFrame(0x03, 0x0d),
  timerStart: encodeTimemoreFrame(0x03, 0x02, [0x01]),
  timerStop: encodeTimemoreFrame(0x03, 0x02, [0x02]),
  timerReset: encodeTimemoreFrame(0x03, 0x02, [0x03]),
  unitGrams: encodeTimemoreFrame(0x03, 0x06, [0x00]),
  modeStandard: encodeTimemoreFrame(0x03, 0x08, [0x01, 0x00]),
  /** App→scale read battery (opcode 0x02, cmd 0x05) — TIMEMORE open-scale-protocol §5.3.2 */
  readBattery: encodeTimemoreFrame(0x02, 0x05),
});

/**
 * Signed int32 big-endian from four bytes.
 * @param {Uint8Array} data
 * @param {number} offset
 */
export function readInt32BeTenthsGram(data, offset) {
  const b0 = data[offset];
  const b1 = data[offset + 1];
  const b2 = data[offset + 2];
  const b3 = data[offset + 3];
  const raw = (b0 << 24) | (b1 << 16) | (b2 << 8) | b3;
  const signed = raw | 0;
  return signed / 10;
}

/**
 * Parse one complete frame starting at index 0 of `slice`.
 * @param {Uint8Array} slice
 * @returns {TimemoreParsedEvent | null}
 */
export function parseTimemoreFrame(slice) {
  if (slice.length < 8) return null;
  if (slice[0] !== FRAME_HEADER || slice[1] !== FRAME_HEADER2) return null;
  const opcode = slice[2];
  const cmdId = slice[3];
  const len = (slice[4] << 8) | slice[5];
  const total = 6 + len + 2;
  if (slice.length < total) return null;
  const body = slice.subarray(0, 6 + len);
  const crcExpected = crc16Modbus(body);
  const crcHi = slice[6 + len];
  const crcLo = slice[6 + len + 1];
  const crcReceived = (crcHi << 8) | crcLo;
  const crcOk = crcExpected === crcReceived;

  const data = slice.subarray(6, 6 + len);
  const base = { opcode, cmdId, crcOk };

  if (cmdId === 0x01 && data.length >= 4) {
    return {
      ...base,
      kind: 'weight',
      weightG: readInt32BeTenthsGram(data, 0),
    };
  }
  if (cmdId === 0x05 && data.length >= 2) {
    return {
      ...base,
      kind: 'battery',
      batteryPercent: data[1],
    };
  }
  return { ...base, kind: 'unknown' };
}

/**
 * Scan a notification buffer for one or more frames.
 * @param {Uint8Array} bytes
 * @param {{ onCrcFailure?: (detail: { opcode: number, cmdId: number }) => void }} [opts]
 * @returns {TimemoreParsedEvent[]}
 */
export function parseTimemoreNotification(bytes, opts = {}) {
  const events = [];
  let i = 0;
  while (i < bytes.length - 1) {
    if (bytes[i] !== FRAME_HEADER || bytes[i + 1] !== FRAME_HEADER2) {
      i += 1;
      continue;
    }
    const len = i + 6 <= bytes.length ? (bytes[i + 4] << 8) | bytes[i + 5] : 0;
    const frameLen = 6 + len + 2;
    if (i + frameLen > bytes.length) break;
    const frame = bytes.subarray(i, i + frameLen);
    const parsed = parseTimemoreFrame(frame);
    if (parsed) {
      if (!parsed.crcOk) {
        opts.onCrcFailure?.({ opcode: parsed.opcode, cmdId: parsed.cmdId });
      }
      events.push(parsed);
    }
    i += frameLen;
  }
  return events;
}

/**
 * Hex fixture helper for tests.
 * @param {string} hex
 */
export function hexToBytes(hex) {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
