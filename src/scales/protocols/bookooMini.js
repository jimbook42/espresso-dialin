/**
 * BOOKOO MINI / Themis-style scale BLE protocol (service 0x0FFE).
 * @see https://github.com/BooKooCode/OpenSource/blob/main/bookoo_mini_scale/protocols.md
 */

export const BOOKOO_SERVICE_UUID = '00000ffe-0000-1000-8000-00805f9b34fb';
export const BOOKOO_WEIGHT_NOTIFY_UUID = '0000ff11-0000-1000-8000-00805f9b34fb';
export const BOOKOO_COMMAND_WRITE_UUID = '0000ff12-0000-1000-8000-00805f9b34fb';

const HEADER_PRODUCT = 0x03;
const TYPE_WEIGHT = 0x0b;
const TYPE_COMMAND = 0x0a;

function xorChecksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum ^= b;
  return sum & 0xff;
}

/**
 * @param {number} cmd
 * @param {number} [data3]
 */
export function encodeBookooCommand(cmd, data3 = 0) {
  const body = [HEADER_PRODUCT, TYPE_COMMAND, cmd, 0x00, data3];
  return new Uint8Array([...body, xorChecksum(body)]);
}

export const BOOKOO_COMMANDS = Object.freeze({
  tare: encodeBookooCommand(0x01),
  timerStart: encodeBookooCommand(0x04),
  timerStop: encodeBookooCommand(0x05),
  timerReset: encodeBookooCommand(0x06),
  tareAndStart: encodeBookooCommand(0x07),
});

/**
 * @param {Uint8Array} data
 * @returns {{ ok: boolean, weightG?: number, batteryPercent?: number }}
 */
export function parseBookooWeightNotification(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 20) return { ok: false };
  if (bytes[0] !== HEADER_PRODUCT || bytes[1] !== TYPE_WEIGHT) return { ok: false };
  const checksum = bytes[bytes.length - 1];
  if (xorChecksum(bytes.slice(0, bytes.length - 1)) !== checksum) return { ok: false };

  const sign = bytes[6] === 0 ? 1 : -1;
  const weightRaw =
    ((bytes[7] & 0xff) << 16) | ((bytes[8] & 0xff) << 8) | (bytes[9] & 0xff);
  const weightG = sign * weightRaw / 100;
  const batteryPercent = bytes[13] & 0xff;
  return { ok: true, weightG, batteryPercent };
}
