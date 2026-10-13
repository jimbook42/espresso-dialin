/**
 * Acaia Lunar / Pearl Web Bluetooth weight protocol (reverse-engineered; pyacaia / Beanconqueror).
 * Supports legacy (gen 1) and current (gen 2) notification layouts.
 */

export const ACAIA_SERVICE_UUID = '713d0002-503a-4e71-8e22-19defcef9b34fb';
export const ACAIA_CHARACTERISTIC_UUID = '713d0003-503a-4e71-8e22-19defcef9b34fb';

/** Legacy Pearl service (gen 1 firmware). */
export const ACAIA_LEGACY_SERVICE_UUID = '00001820-0000-1000-8000-00805f9b34fb';

/** Heartbeat / keep-alive (gen 2). */
export const ACAIA_HEARTBEAT_FRAME = new Uint8Array([0x00, 0x00, 0x02, 0x00]);

/** @typedef {'gen1' | 'gen2' | 'unknown'} AcaiaProtocolGeneration */

/**
 * @param {Uint8Array} data
 * @returns {{ ok: boolean, weightG?: number, generation?: AcaiaProtocolGeneration }}
 */
export function parseAcaiaWeightNotification(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 6) return { ok: false };

  // Gen 2 weight message (type 0x05, 7 bytes) — recorded sample from Beanconqueror fixtures.
  if (bytes[0] === 0x05 && bytes.length >= 7) {
    const sign = bytes[1] === 1 ? -1 : 1;
    const raw = (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
    return { ok: true, weightG: sign * raw / 100, generation: 'gen2' };
  }

  // Gen 1 / alternate (type 0x0c, 10 bytes).
  if (bytes[0] === 0x0c && bytes.length >= 10) {
    const sign = bytes[1] === 1 ? -1 : 1;
    const raw = (bytes[2] << 16) | (bytes[3] << 8) | bytes[4];
    return { ok: true, weightG: sign * raw / 10, generation: 'gen1' };
  }

  return { ok: false };
}

/**
 * @param {Uint8Array} data
 * @returns {boolean}
 */
export function isAcaiaHeartbeatAck(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytes.length >= 2 && bytes[0] === 0x00 && bytes[1] === 0x00;
}
