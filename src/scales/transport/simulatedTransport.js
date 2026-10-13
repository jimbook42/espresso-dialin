/**
 * Realistic espresso shot weight curve for QA without hardware.
 * Pre-infusion holds low weight, then ramps toward target yield.
 *
 * @param {{ targetYieldG?: number, preinfusionDurationS?: number, tickMs?: number }} [config]
 * @returns {import('./scaleTransport.js').ScaleTransport}
 */
export function createSimulatedTransport(config = {}) {
  const targetYieldG = Number(config.targetYieldG) > 0 ? Number(config.targetYieldG) : 36;
  const preinfusionDurationS = Number(config.preinfusionDurationS) >= 0 ? Number(config.preinfusionDurationS) : 8;
  const tickMs = config.tickMs ?? 100;

  let connected = false;
  let running = false;
  let extractionStarted = false;
  let shotStartMs = 0;
  let timerStartMs = 0;
  let intervalId = null;

  const weightHandlers = new Set();
  const timerHandlers = new Set();

  const emitWeight = (w) => {
    const evt = { weightG: w, timestampMs: Date.now() };
    weightHandlers.forEach((h) => h(evt));
  };

  const emitTimer = (timerS, runningFlag) => {
    timerHandlers.forEach((h) => h({ timerS, running: runningFlag }));
  };

  const preinfusionDripMaxG = Math.max(5.5, targetYieldG * 0.12);

  const computeWeight = (elapsedShotS) => {
    if (!extractionStarted) {
      const preProgress = preinfusionDurationS > 0 ? Math.min(1, elapsedShotS / preinfusionDurationS) : 1;
      const eased = 1 - Math.pow(1 - preProgress, 1.6);
      return eased * preinfusionDripMaxG;
    }
    const extractT = Math.max(0, elapsedShotS - preinfusionDurationS);
    const rampDuration = 28;
    const progress = Math.min(1, extractT / rampDuration);
    const ease = 1 - Math.pow(1 - progress, 2.2);
    const drip = ease * targetYieldG;
    const noise = Math.sin(extractT * 4.1) * 0.08;
    return Math.min(targetYieldG + 0.4, drip + noise + 0.2);
  };

  const tick = () => {
    if (!running) return;
    const now = Date.now();
    const elapsedShotS = (now - shotStartMs) / 1000;
    emitWeight(computeWeight(elapsedShotS));
    if (extractionStarted) {
      const timerS = (now - timerStartMs) / 1000;
      emitTimer(timerS, true);
    }
  };

  return {
    getLabel: () => 'Simulated Timemore Dot',
    isConnected: () => connected,
    async connect() {
      connected = true;
      running = false;
      extractionStarted = false;
    },
    async disconnect() {
      connected = false;
      running = false;
      extractionStarted = false;
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    },
    onWeight(handler) {
      weightHandlers.add(handler);
      return () => weightHandlers.delete(handler);
    },
    onTimer(handler) {
      timerHandlers.add(handler);
      return () => timerHandlers.delete(handler);
    },
    async tare() {
      emitWeight(0);
    },
    async startTimer() {
      if (!connected) return;
      running = true;
      shotStartMs = Date.now();
      timerStartMs = shotStartMs;
      extractionStarted = preinfusionDurationS <= 0;
      if (!intervalId) {
        intervalId = setInterval(tick, tickMs);
      }
      emitTimer(0, true);
      tick();
    },
    async stopTimer() {
      const finalTimerS = extractionStarted && timerStartMs ? (Date.now() - timerStartMs) / 1000 : 0;
      running = false;
      extractionStarted = false;
      emitTimer(finalTimerS, false);
    },
    /** End pre-infusion: extraction timer starts here (not at first drip). */
    endPreinfusion() {
      if (!running) return;
      extractionStarted = true;
      timerStartMs = Date.now();
      emitTimer(0, true);
    },
    preinfusionDurationS,
    targetYieldG,
  };
}
