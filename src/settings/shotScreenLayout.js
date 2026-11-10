import { isLabCameraPressureEnabled } from './labCameraPressure.js';
import { isSmartScaleIntegrationActive } from './scalePreference.js';

export const SHOT_METRICS = ['pressure', 'weight', 'time', 'flow'];

export function shotEquipment(settings) {
  return {
    gauge: isLabCameraPressureEnabled(settings),
    scale: settings?.shotScreen?.scale ?? isSmartScaleIntegrationActive(settings),
  };
}

export function availableShotMetrics({ gauge, scale }) {
  return SHOT_METRICS.filter((metric) => metric === 'time'
    || (metric === 'pressure' ? gauge : scale));
}

export function recommendedShotScreen(equipment) {
  return {
    bigNumber: availableShotMetrics(equipment)[0],
    chart: equipment.gauge || equipment.scale,
    cameraPreview: equipment.gauge,
    minimal: false,
    showGauge: false,
  };
}

export function resolveShotScreen(settings, equipment = shotEquipment(settings)) {
  const available = availableShotMetrics(equipment);
  const options = { ...recommendedShotScreen(equipment), ...settings?.shotScreen };
  return {
    ...options,
    bigNumber: available.includes(options.bigNumber) ? options.bigNumber : available[0],
    chart: Boolean(options.chart && (equipment.gauge || equipment.scale)),
    cameraPreview: Boolean(options.cameraPreview && equipment.gauge),
    showGauge: Boolean(options.showGauge && equipment.gauge),
    layout: equipment.gauge ? (equipment.scale ? 'gauge-scale' : 'gauge')
      : equipment.scale ? 'scale' : 'timer',
    available,
  };
}

export function cycleShotMetric(current, available) {
  return available[(available.indexOf(current) + 1) % available.length];
}

// Remember Show gauge / Hide gauge without touching the camera-preview choice.
export function shotGaugeVisibilityPatch(showGauge, shotScreen) {
  const current = shotScreen && typeof shotScreen === 'object' ? shotScreen : undefined;
  return { shotScreen: { ...current, showGauge: Boolean(showGauge) } };
}

// Reset presentation choices when equipment changes; preserve all other settings.
export function shotEquipmentPatch(equipment) {
  return {
    labCameraPressureEnabled: equipment.gauge,
    shotScreen: { ...recommendedShotScreen(equipment), scale: equipment.scale },
  };
}
