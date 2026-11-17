import { isAndroidApp } from '../../native/androidShell.js';
import { androidGatt } from './androidGatt.js';
import { createAcaiaTransport } from './createAcaiaTransport.js';
import { createBookooTransport } from './createBookooTransport.js';
import { createWebBluetoothTransport } from './webBluetoothTransport.js';

/**
 * @param {string} deviceId
 * @returns {import('./scaleTransport.js').ScaleTransport}
 */
export function createBluetoothScaleTransport(deviceId, options) {
  const native = isAndroidApp ? androidGatt(deviceId, options) : null;
  const create = deviceId === 'acaia-lunar-pearl' ? createAcaiaTransport
    : deviceId === 'bookoo-themis' ? createBookooTransport : createWebBluetoothTransport;
  const transport = create(native?.requestDevice);
  if (native) transport.remember = native.remember;
  return transport;
}
