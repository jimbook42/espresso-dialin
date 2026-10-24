export const BLE_BATTERY_SERVICE_UUID = 0x180f;
export const BLE_BATTERY_LEVEL_CHARACTERISTIC_UUID = 0x2a19;

/**
 * Standard GATT Battery Level (0–100 %).
 * @param {DataView | ArrayBuffer | Uint8Array | null | undefined} value
 * @returns {number | null}
 */
export function parseBleBatteryLevelPercent(value) {
  if (!value) return null;
  let view = value;
  if (value instanceof Uint8Array) {
    view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  } else if (value instanceof ArrayBuffer) {
    view = new DataView(value);
  }
  if (!(view instanceof DataView) || view.byteLength < 1) return null;
  const n = view.getUint8(0);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return n;
}
