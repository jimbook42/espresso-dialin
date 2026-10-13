import { SCALE_DEVICES } from '../scales/scaleRegistry.js';

export const SMART_SCALE_MANUAL_ID = 'manual';
export const SMART_SCALE_NOT_LISTED_ID = 'not-listed';

export function listSmartScalePickerOptions() {
  return [
    { id: SMART_SCALE_MANUAL_ID, label: 'No (manual timing)' },
    ...SCALE_DEVICES.map((d) => ({ id: d.id, label: d.label })),
    { id: SMART_SCALE_NOT_LISTED_ID, label: 'Not listed — use manual timing' },
  ];
}

export function normalizeSmartScaleDeviceId(raw) {
  if (raw === null || raw === undefined || raw === '' || raw === SMART_SCALE_MANUAL_ID) {
    return SMART_SCALE_MANUAL_ID;
  }
  if (raw === SMART_SCALE_NOT_LISTED_ID) return SMART_SCALE_NOT_LISTED_ID;
  const known = SCALE_DEVICES.some((d) => d.id === raw);
  return known ? raw : SMART_SCALE_MANUAL_ID;
}

/** Live weight / flow on Dial+timer when the user chose a supported scale model in Settings. */
export function isSmartScaleIntegrationActive(settings) {
  const id = normalizeSmartScaleDeviceId(settings?.smartScaleDeviceId);
  return SCALE_DEVICES.some((d) => d.id === id);
}

export function smartScaleChoiceSummary(settings) {
  const id = normalizeSmartScaleDeviceId(settings?.smartScaleDeviceId);
  if (id === SMART_SCALE_MANUAL_ID) return 'Manual';
  if (id === SMART_SCALE_NOT_LISTED_ID) return 'Manual (scale not listed)';
  const device = SCALE_DEVICES.find((d) => d.id === id);
  return device?.label || 'Manual';
}
