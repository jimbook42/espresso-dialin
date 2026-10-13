import {
  TIMEMORE_COMMAND_FRAMES,
  TIMEMORE_DOT_NOTIFY_UUID,
  TIMEMORE_DOT_SERVICE_UUID,
  TIMEMORE_DOT_WRITE_UUID,
  parseTimemoreNotification,
} from '../protocols/timemoreFramed.js';
const WRITE_GAP_MS = 50;

/** @returns {boolean} */
export function isWebBluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth?.requestDevice;
}

/**
 * @returns {import('./scaleTransport.js').ScaleTransport}
 */
export function createWebBluetoothTransport() {
  /** @type {BluetoothDevice | null} */
  let device = null;
  /** @type {BluetoothRemoteGATTCharacteristic | null} */
  let notifyChar = null;
  /** @type {BluetoothRemoteGATTCharacteristic | null} */
  let writeChar = null;
  let writeChain = Promise.resolve();

  const weightHandlers = new Set();
  const timerHandlers = new Set();
  const disconnectHandlers = new Set();

  const enqueueWrite = (bytes) => {
    writeChain = writeChain
      .then(() => new Promise((r) => setTimeout(r, WRITE_GAP_MS)))
      .then(() => {
        if (!writeChar) return;
        return writeChar.writeValueWithoutResponse(bytes);
      })
      .catch((err) => {
        console.warn('[scale] BLE write failed', err);
      });
    return writeChain;
  };

  const runConnectSequence = async () => {
    await new Promise((r) => setTimeout(r, 500));
    await enqueueWrite(TIMEMORE_COMMAND_FRAMES.unitGrams);
    await new Promise((r) => setTimeout(r, 200));
    await enqueueWrite(TIMEMORE_COMMAND_FRAMES.modeStandard);
  };

  const handleNotification = (event) => {
    const value = event.target?.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const events = parseTimemoreNotification(bytes, {
      onCrcFailure: (detail) => {
        console.warn('[scale] CRC mismatch', detail);
      },
    });
    for (const evt of events) {
      if (evt.kind === 'weight' && typeof evt.weightG === 'number') {
        const payload = { weightG: evt.weightG, timestampMs: Date.now() };
        weightHandlers.forEach((h) => h(payload));
      }
    }
  };

  return {
    getLabel: () => device?.name || 'Timemore scale',
    isConnected: () => !!device?.gatt?.connected,
    async connect() {
      if (!isWebBluetoothAvailable()) {
        throw new Error('Web Bluetooth is not available in this browser.');
      }
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'TIMEMORE' },
          { namePrefix: 'Timemore' },
          { namePrefix: 'DOT' },
          { namePrefix: 'Dot' },
          { namePrefix: 'TES017' },
          { services: [0xfff0] },
        ],
        optionalServices: [0xfff0, 0x181d],
      });

      device.addEventListener('gattserverdisconnected', () => {
        notifyChar = null;
        writeChar = null;
        disconnectHandlers.forEach((h) => h('gatt disconnected'));
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(TIMEMORE_DOT_SERVICE_UUID);
      notifyChar = await service.getCharacteristic(TIMEMORE_DOT_NOTIFY_UUID);
      writeChar = await service.getCharacteristic(TIMEMORE_DOT_WRITE_UUID);
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', handleNotification);
      await runConnectSequence();
    },
    async disconnect() {
      try {
        if (notifyChar) {
          notifyChar.removeEventListener('characteristicvaluechanged', handleNotification);
          await notifyChar.stopNotifications().catch(() => {});
        }
        device?.gatt?.disconnect();
      } finally {
        notifyChar = null;
        writeChar = null;
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
      await enqueueWrite(TIMEMORE_COMMAND_FRAMES.tare);
    },
    async startTimer() {
      await enqueueWrite(TIMEMORE_COMMAND_FRAMES.timerStart);
    },
    async stopTimer() {
      await enqueueWrite(TIMEMORE_COMMAND_FRAMES.timerStop);
    },
    onDisconnect(handler) {
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },
  };
}
