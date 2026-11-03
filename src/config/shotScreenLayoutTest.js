/** Layout-only browser hook: run Vite dev and open ?shotScreenTest=1.
 * Skips start-time calibration/zero prompts. Does not fabricate a calibration
 * or readings; an uncalibrated gauge still displays a dash. Production is off.
 */
export function isShotScreenLayoutTest() {
  return import.meta.env.DEV === true
    && import.meta.env.PROD !== true
    && typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('shotScreenTest') === '1';
}
