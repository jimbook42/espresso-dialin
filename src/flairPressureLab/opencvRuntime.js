/** Lazy-loaded OpenCV.js (Apache-2.0). Self-hosted under /flair-pressure-lab/opencv.js — not in the main bundle. */

let cvInstance = null;
let loadPromise = null;

const BASE_URL = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
/** Stable path segment for bundle checks and script URL (see opencvBundle.vitest.js). */
export const OPENCV_ASSET_PATH = 'flair-pressure-lab/opencv.js';
const OPENCV_URL = `${BASE_URL}${OPENCV_ASSET_PATH}`;

async function initCvModule(cvModule) {
  if (cvModule instanceof Promise) {
    return await cvModule;
  }
  if (cvModule.Mat) {
    return cvModule;
  }
  await new Promise((resolve) => {
    cvModule.onRuntimeInitialized = () => resolve();
  });
  return cvModule;
}

/**
 * Load OpenCV once. Safe to call from FlairPressureLab on mount.
 * @returns {Promise<typeof cv>}
 */
export function loadOpenCv() {
  if (cvInstance) return Promise.resolve(cvInstance);
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      if (typeof document === 'undefined') {
        reject(new Error('OpenCV.js requires a browser document'));
        return;
      }
      const existing = document.querySelector('script[data-pressure-lab-opencv]');
      if (existing) {
        existing.addEventListener('load', () => {
          initCvModule(globalThis.cv).then(resolve).catch(reject);
        });
        existing.addEventListener('error', () => reject(new Error('OpenCV script failed')));
        if (globalThis.cv) {
          initCvModule(globalThis.cv).then(resolve).catch(reject);
        }
        return;
      }
      const script = document.createElement('script');
      script.src = OPENCV_URL;
      script.async = true;
      script.dataset.pressureLabOpencv = '1';
      script.onload = () => {
        initCvModule(globalThis.cv).then(resolve).catch(reject);
      };
      script.onerror = () => reject(new Error(`Failed to load ${OPENCV_URL}`));
      document.head.appendChild(script);
    }).then((cv) => {
      cvInstance = cv;
      return cv;
    });
  }
  return loadPromise;
}

/** @returns {typeof cv | null} */
export function getOpenCvSync() {
  return cvInstance;
}

export function isOpenCvReady() {
  return cvInstance != null;
}

/** Test / harness: reset loader state between cases. */
export function resetOpenCvForTests() {
  cvInstance = null;
  loadPromise = null;
}

/** Vitest: inject a minimal OpenCV.js stub without loading the WASM build. */
export function setOpenCvForTests(cv) {
  cvInstance = cv;
  loadPromise = cv ? Promise.resolve(cv) : null;
}
