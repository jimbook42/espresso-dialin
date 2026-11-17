import { redactDiagnosticEvents } from './diagnosticLog.js';
import { diagnosticsBuild } from '../scales/shotDeviceDiagnostics.js';

const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const safeModel = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9 ._()-]{0,79}$/i.test(value) ? value : null;

export function buildProblemReport({ platform, device, events, trace, description = '' }) {
  const scale = trace?.scaleDiagnostics;
  return {
    format: 'espresso-dial-in/problem-report',
    version: 1,
    build: diagnosticsBuild,
    platform: platform === 'android' ? 'android' : 'web',
    device: device ? { androidVersion: safeModel(device.androidVersion), model: safeModel(device.model) } : null,
    events: redactDiagnosticEvents(events),
    shotDeviceSummary: trace ? {
      eventCount: Array.isArray(trace.events) ? trace.events.length : null,
      weightGapCount: count(scale?.gapCount),
      sensorEvidence: scale?.notificationAvailability === 'observed' ? 'scale-observations' : 'unavailable',
    } : null,
    ...(description.trim() ? { description: description.trim().slice(0, 1000) } : {}),
  };
}
