import { TIMEMORE_DOT_SERVICE_UUID } from './protocols/timemoreFramed.js';

/** @typedef {'timemore-dot'} ScaleDeviceId */

/**
 * @typedef {Object} ScaleDeviceDefinition
 * @property {ScaleDeviceId} id
 * @property {string} label
 * @property {(name: string, serviceUuids?: string[]) => boolean} match
 * @property {'timemore-framed'} protocol
 */

export const SCALE_DEVICES = Object.freeze([
  {
    id: 'timemore-dot',
    label: 'Timemore Black Mirror Dot',
    protocol: 'timemore-framed',
    match(name, serviceUuids = []) {
      const lower = (name || '').toLowerCase();
      if (lower.includes('dot') || lower.includes('tes017')) return true;
      return serviceUuids.some((u) => u.toLowerCase().includes('fff0'));
    },
  },
]);

/**
 * @param {string} name
 * @param {string[]} [serviceUuids]
 */
export function matchScaleDevice(name, serviceUuids) {
  return SCALE_DEVICES.find((d) => d.match(name, serviceUuids)) || null;
}

export { TIMEMORE_DOT_SERVICE_UUID };
