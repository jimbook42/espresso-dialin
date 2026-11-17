import { useSyncExternalStore } from 'react';
import { isOpenCvReady } from '../opencvRuntime.js';
import { isNeedleModelReady } from '../needleModel.js';

export const PRESSURE_CAMERA_OFFLINE_MESSAGE =
  'Pressure camera unavailable offline. Reconnect to the internet to try again.';

function subscribe(onChange) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const isOffline = () => globalThis.navigator?.onLine === false;

export function usePressureCameraOffline() {
  const offline = useSyncExternalStore(subscribe, isOffline);
  // Skip a cold load offline: an unsuccessful WASM initialization can stay
  // failed for the lifetime of the page.
  return offline && !(isOpenCvReady() && isNeedleModelReady());
}
