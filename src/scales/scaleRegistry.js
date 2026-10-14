import { TIMEMORE_DOT_SERVICE_UUID } from './protocols/timemoreFramed.js';

/** @typedef {'timemore-dot' | 'acaia-lunar-pearl' | 'bookoo-themis'} ScaleDeviceId */

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
  {
    id: 'acaia-lunar-pearl',
    label: 'Acaia Lunar / Pearl',
    protocol: 'acaia',
    match(name) {
      const lower = (name || '').toLowerCase();
      return lower.includes('acaia') || lower.includes('lunar') || lower.includes('pearl');
    },
  },
  {
    id: 'bookoo-themis',
    label: 'Bookoo Themis',
    protocol: 'bookoo-mini',
    match(name) {
      const lower = (name || '').toLowerCase();
      return lower.includes('bookoo') || lower.includes('themis');
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
