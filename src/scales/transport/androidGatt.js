import { recordDiagnostic } from '../../beta/diagnosticLog.js';
import { BleClient, numberToUUID } from '@capacitor-community/bluetooth-le';
import { AndroidShell } from '../../native/androidShell.js';

const keyFor = (model) => 'dialin.android.scale.' + model;
const uuid = (value) => typeof value === 'number' ? numberToUUID(value) : value;

export function rememberedAndroidScale(model) {
  try {
    const device = JSON.parse(localStorage.getItem(keyFor(model)));
    return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(device?.deviceId) ? device : null;
  } catch {
    return null;
  }
}

// Present the small GATT surface the existing protocol transports consume.
export function androidGatt(model, { reconnect = false, signal } = {}) {
  let peripheral;
  return {
    remember() {
      if (!peripheral) return;
      try {
        localStorage.setItem(keyFor(model), JSON.stringify(peripheral));
      } catch {
        // A usable connection does not depend on writable local storage.
      }
    },
    async requestDevice() {
      if (reconnect && !(await AndroidShell.hasBluetoothPermissions()).granted) {
        recordDiagnostic('ble', 'permission-unavailable');
        throw new Error('Bluetooth permission is required.');
      }
      signal?.throwIfAborted();
      try {
        await BleClient.initialize({ androidNeverForLocation: true });
      } catch (error) {
        recordDiagnostic('ble', 'initialization-failed');
        throw error;
      }
      signal?.throwIfAborted();
      if (!(await BleClient.isEnabled())) {
        recordDiagnostic('ble', 'disabled');
        throw new Error('Bluetooth is turned off.');
      }
      // Android's chooser cannot express the existing name-prefix OR service filters.
      // The selected scale is accepted only if its expected GATT profile opens.
      const selected = reconnect ? rememberedAndroidScale(model) : await BleClient.requestDevice();
      peripheral = selected && { deviceId: selected.deviceId, name: selected.name };
      signal?.throwIfAborted();
      if (!peripheral) throw new Error('No remembered scale.');
      if (!reconnect) recordDiagnostic('ble', 'peripheral-selected');
      const { deviceId, name } = peripheral;
      const device = new EventTarget();
      device.name = name;
      let services = [];
      let connecting = false;
      const gatt = {
        connected: false,
        async connect() {
          connecting = true;
          try {
            await BleClient.connect(deviceId, () => {
              gatt.connected = false;
              device.dispatchEvent(new Event('gattserverdisconnected'));
            }, { timeout: 8000 });
            gatt.connected = true;
            signal?.throwIfAborted();
            services = await BleClient.getServices(deviceId);
            signal?.throwIfAborted();
            return gatt;
          } catch (error) {
            await gatt.disconnect();
            throw error;
          } finally {
            connecting = false;
          }
        },
        async disconnect() {
          if (!gatt.connected && !connecting) return;
          gatt.connected = false;
          await BleClient.disconnect(deviceId);
        },
        async getPrimaryService(serviceId) {
          serviceId = uuid(serviceId);
          const service = services.find(({ uuid }) => uuid === serviceId);
          if (!gatt.connected || !service) throw new Error('Expected scale service is unavailable.');
          return {
            async getCharacteristic(characteristicId) {
              characteristicId = uuid(characteristicId);
              if (!service.characteristics.some(({ uuid }) => uuid === characteristicId)) {
                throw new Error('Expected scale characteristic is unavailable.');
              }
              const characteristic = new EventTarget();
              const address = [deviceId, serviceId, characteristicId];
              characteristic.readValue = () => BleClient.read(...address);
              characteristic.writeValueWithoutResponse = async (bytes) => {
                signal?.throwIfAborted();
                if (!gatt.connected) throw new Error('Scale is disconnected.');
                await BleClient.writeWithoutResponse(
                  ...address, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
                );
              };
              characteristic.startNotifications = () => BleClient.startNotifications(...address, (value) => {
                if (!gatt.connected || signal?.aborted) return;
                characteristic.value = value;
                characteristic.dispatchEvent(new Event('characteristicvaluechanged'));
              });
              characteristic.stopNotifications = () => BleClient.stopNotifications(...address);
              return characteristic;
            },
          };
        },
      };
      device.gatt = gatt;
      return device;
    },
  };
}
