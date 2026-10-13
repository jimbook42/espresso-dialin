/**
 * @typedef {Object} ScaleWeightEvent
 * @property {number} weightG
 * @property {number} [timestampMs]
 */

/**
 * @typedef {Object} ScaleTimerEvent
 * @property {number} timerS
 * @property {boolean} [running]
 */

/**
 * Scale transport contract (Web Bluetooth today; Capacitor later).
 *
 * @typedef {Object} ScaleTransport
 * @property {() => Promise<void>} connect
 * @property {() => Promise<void>} disconnect
 * @property {(handler: (event: ScaleWeightEvent) => void) => () => void} onWeight
 * @property {(handler: (event: ScaleTimerEvent) => void) => () => void} onTimer
 * @property {() => Promise<void>} tare
 * @property {() => Promise<void>} startTimer
 * @property {() => Promise<void>} stopTimer
 * @property {() => boolean} [isConnected]
 * @property {() => string} [getLabel]
 */

export function noopUnsubscribe() {}
