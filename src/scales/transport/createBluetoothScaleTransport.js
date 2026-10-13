import { createAcaiaTransport } from './createAcaiaTransport.js';
import { createBookooTransport } from './createBookooTransport.js';
import { createWebBluetoothTransport } from './webBluetoothTransport.js';

/**
 * @param {string} deviceId
 * @returns {import('./scaleTransport.js').ScaleTransport}
 */
export function createBluetoothScaleTransport(deviceId) {
  if (deviceId === 'acaia-lunar-pearl') return createAcaiaTransport();
  if (deviceId === 'bookoo-themis') return createBookooTransport();
  return createWebBluetoothTransport();
}
