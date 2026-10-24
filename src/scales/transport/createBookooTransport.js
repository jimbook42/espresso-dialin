import {
  BOOKOO_COMMANDS,
  BOOKOO_COMMAND_WRITE_UUID,
  BOOKOO_SERVICE_UUID,
  BOOKOO_WEIGHT_NOTIFY_UUID,
  parseBookooWeightNotification,
} from '../protocols/bookooMini.js';

/** @returns {import('./scaleTransport.js').ScaleTransport} */
export function createBookooTransport() {
  let device = null;
  let notifyChar = null;
  let writeChar = null;
  const weightHandlers = new Set();
  const batteryHandlers = new Set();
  const disconnectHandlers = new Set();

  const handleNotification = (event) => {
    const value = event.target?.value;
    if (!value) return;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    const parsed = parseBookooWeightNotification(bytes);
    if (!parsed.ok) return;
    if (typeof parsed.weightG === 'number') {
      weightHandlers.forEach((h) => h({ weightG: parsed.weightG, timestampMs: Date.now() }));
    }
    if (typeof parsed.batteryPercent === 'number') {
      batteryHandlers.forEach((h) => h({ batteryPercent: parsed.batteryPercent }));
    }
  };

  return {
    getLabel: () => device?.name || 'BOOKOO scale',
    isConnected: () => !!device?.gatt?.connected,
    async connect() {
      device = await navigator.bluetooth.requestDevice({
        filters: [
          { namePrefix: 'BOOKOO' },
          { namePrefix: 'Bookoo' },
          { namePrefix: 'THEMIS' },
          { namePrefix: 'Themis' },
          { services: [BOOKOO_SERVICE_UUID] },
        ],
        optionalServices: [BOOKOO_SERVICE_UUID],
      });

      device.addEventListener('gattserverdisconnected', () => {
        notifyChar = null;
        writeChar = null;
        disconnectHandlers.forEach((h) => h('gatt disconnected'));
      });

      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(BOOKOO_SERVICE_UUID);
      notifyChar = await service.getCharacteristic(BOOKOO_WEIGHT_NOTIFY_UUID);
      writeChar = await service.getCharacteristic(BOOKOO_COMMAND_WRITE_UUID);
      await notifyChar.startNotifications();
      notifyChar.addEventListener('characteristicvaluechanged', handleNotification);
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
    onTimer() {
      return () => {};
    },
    onBattery(handler) {
      batteryHandlers.add(handler);
      return () => batteryHandlers.delete(handler);
    },
    async tare() {
      await writeChar?.writeValueWithoutResponse(BOOKOO_COMMANDS.tare);
    },
    async startTimer() {
      await writeChar?.writeValueWithoutResponse(BOOKOO_COMMANDS.tareAndStart);
    },
    async stopTimer() {
      await writeChar?.writeValueWithoutResponse(BOOKOO_COMMANDS.timerStop);
    },
    onDisconnect(handler) {
      disconnectHandlers.add(handler);
      return () => disconnectHandlers.delete(handler);
    },
  };
}
