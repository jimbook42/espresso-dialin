import {
  ACAIA_CHARACTERISTIC_UUID,
  ACAIA_HEARTBEAT_FRAME,
  ACAIA_LEGACY_SERVICE_UUID,
  ACAIA_SERVICE_UUID,
  parseAcaiaWeightNotification,
} from '../protocols/acaia.js';

const HEARTBEAT_MS = 2500;

/** @returns {import('./scaleTransport.js').ScaleTransport} */
export function createAcaiaTransport() {
  let device = null;
  let notifyChar = null;
  let writeChar = null;
  let heartbeatTimer = null;
  const weightHandlers = new Set();
  const disconnectHandlers = new Set();

  const handleNotification = (event) => {
    const value = event.target?.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const parsed = parseAcaiaWeightNotification(bytes);
    if (parsed.ok && typeof parsed.weightG === 'number') {
      weightHandlers.forEach((h) => h({ weightG: parsed.weightG, timestampMs: Date.now() }));
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (writeChar) {
        writeChar.writeValueWithoutResponse(ACAIA_HEARTBEAT_FRAME).catch(() => {});
      }
    }, HEARTBEAT_MS);
  };

  const stopHeartbeat = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  };

  return {
    getLabel: () => device?.name || 'Acaia scale',
    isConnected: () => !!device?.gatt?.connected,
    async connect() {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'ACAIA' },
          { namePrefix: 'Acaia' },
          { namePrefix: 'LUNAR' },
          { namePrefix: 'Lunar' },
          { namePrefix: 'PEARL' },
          { namePrefix: 'Pearl' },
          { services: [ACAIA_SERVICE_UUID] },
          { services: [ACAIA_LEGACY_SERVICE_UUID] },
        ],
        optionalServices: [ACAIA_SERVICE_UUID, ACAIA_LEGACY_SERVICE_UUID],
      });

      device.addEventListener('gattserverdisconnected', () => {
        stopHeartbeat();
        notifyChar = null;
        writeChar = null;
        disconnectHandlers.forEach((h) => h('gatt disconnected'));
      });

      const server = await device.gatt.connect();
      let service;
      try {
        service = await server.getPrimaryService(ACAIA_SERVICE_UUID);
      } catch {
        service = await server.getPrimaryService(ACAIA_LEGACY_SERVICE_UUID);
      }
      notifyChar = await service.getCharacteristic(ACAIA_CHARACTERISTIC_UUID);
      writeChar = notifyChar;
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', handleNotification);
      startHeartbeat();
    },
    async disconnect() {
      stopHeartbeat();
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
    onTimer() {
      return () => {};
    },
    async tare() {
      const frame = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      await writeChar?.writeValueWithoutResponse(frame);
    },
    async startTimer() {},
    async stopTimer() {},
    onDisconnect(handler) {
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },
  };
}
