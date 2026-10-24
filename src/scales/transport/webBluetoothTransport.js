import {
  TIMEMORE_COMMAND_FRAMES,
  TIMEMORE_DOT_NOTIFY_UUID,
  TIMEMORE_DOT_SERVICE_UUID,
  TIMEMORE_DOT_WRITE_UUID,
  parseTimemoreNotification,
} from '../protocols/timemoreFramed.js';
import {
  BLE_BATTERY_LEVEL_CHARACTERISTIC_UUID,
  BLE_BATTERY_SERVICE_UUID,
  parseBleBatteryLevelPercent,
} from '../bleBatteryService.js';
import { logUnknownTimemoreFrame } from '../scaleDebug.js';

const WRITE_GAP_MS = 50;

/** @returns {boolean} */
export function isWebBluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth?.requestDevice;
}

/**
 * @param {BluetoothRemoteGATTServer} server
 * @param {(pct: number) => void} onPercent
 */
export async function attachStandardBleBatteryService(server, onPercent) {
  try {
    const service = await server.getPrimaryService(BLE_BATTERY_SERVICE_UUID);
    const characteristic = await service.getCharacteristic(BLE_BATTERY_LEVEL_CHARACTERISTIC_UUID);

    const emit = (value) => {
      const pct = parseBleBatteryLevelPercent(value);
      if (pct != null) onPercent(pct);
    };

    try {
      const initial = await characteristic.readValue();
      emit(initial);
    } catch {
      // characteristic may be notify-only on some devices
    }

    try {
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (event) => {
        emit(event.target?.value);
      });
    } catch {
      // no notifications
    }
  } catch {
    // Battery service not exposed
  }
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
  const batteryHandlers = new Set();
  const disconnectHandlers = new Set();

  const emitBatteryPercent = (batteryPercent) => {
    if (typeof batteryPercent !== 'number') return;
    const payload = { batteryPercent };
    batteryHandlers.forEach((h) => h(payload));
  };

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
    await new Promise((r) => setTimeout(r, 200));
    await enqueueWrite(TIMEMORE_COMMAND_FRAMES.readBattery);
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
      } else if (evt.kind === 'battery' && typeof evt.batteryPercent === 'number') {
        emitBatteryPercent(evt.batteryPercent);
      } else if (evt.kind === 'unknown') {
        logUnknownTimemoreFrame({ opcode: evt.opcode, cmdId: evt.cmdId });
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
        optionalServices: [0xfff0, 0x181d, BLE_BATTERY_SERVICE_UUID],
      });

      device.addEventListener('gattserverdisconnected', () => {
        notifyChar = null;
        writeChar = null;
        disconnectHandlers.forEach((h) => h('gatt disconnected'));
      });

      const server = await device.gatt.connect();
      await attachStandardBleBatteryService(server, emitBatteryPercent);

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
    onBattery(handler) {
      batteryHandlers.add(handler);
      return () => batteryHandlers.delete(handler);
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
