import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { AndroidShell } from '../../native/androidShell.js';
import { androidGatt, rememberedAndroidScale } from './androidGatt.js';

vi.mock('@capacitor-community/bluetooth-le', () => ({
  BleClient: {
    initialize: vi.fn(), isEnabled: vi.fn(), requestDevice: vi.fn(),
    connect: vi.fn(), disconnect: vi.fn(), getServices: vi.fn(),
  },
}));
vi.mock('../../native/androidShell.js', () => ({
  AndroidShell: { hasBluetoothPermissions: vi.fn() },
}));

const model = 'bookoo-themis';
const peripheral = { deviceId: '12:34:56:78:9A:BC', name: 'Test peripheral' };

describe('Android scale connection boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    const storage = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    });
    BleClient.isEnabled.mockResolvedValue(true);
    BleClient.requestDevice.mockResolvedValue(peripheral);
  });

  it('reconnects directly to the selected address without opening a chooser', async () => {
    const initial = androidGatt(model);
    await initial.requestDevice();
    initial.remember();
    expect(rememberedAndroidScale(model)).toEqual(peripheral);
    expect(rememberedAndroidScale('timemore-dot')).toBeNull();
    BleClient.requestDevice.mockClear();
    AndroidShell.hasBluetoothPermissions.mockResolvedValue({ granted: true });
    const device = await androidGatt(model, { reconnect: true }).requestDevice();
    await device.gatt.connect();
    expect(BleClient.requestDevice).not.toHaveBeenCalled();
    expect(BleClient.connect).toHaveBeenCalledWith(peripheral.deviceId, expect.any(Function), { timeout: 8000 });
  });

  it('does not initialize the plugin or prompt during reconnect without permission', async () => {
    AndroidShell.hasBluetoothPermissions.mockResolvedValue({ granted: false });
    await expect(androidGatt(model, { reconnect: true }).requestDevice()).rejects.toThrow('permission');
    expect(BleClient.initialize).not.toHaveBeenCalled();
    expect(BleClient.connect).not.toHaveBeenCalled();
    expect(BleClient.requestDevice).not.toHaveBeenCalled();
  });

  it('stays off GATT when Bluetooth is disabled and can reuse the identity after it is enabled', async () => {
    const initial = androidGatt(model);
    await initial.requestDevice();
    initial.remember();
    BleClient.requestDevice.mockClear();
    AndroidShell.hasBluetoothPermissions.mockResolvedValue({ granted: true });
    BleClient.isEnabled.mockResolvedValueOnce(false);
    await expect(androidGatt(model, { reconnect: true }).requestDevice()).rejects.toThrow('turned off');
    expect(BleClient.connect).not.toHaveBeenCalled();
    const device = await androidGatt(model, { reconnect: true }).requestDevice();
    await device.gatt.connect();
    expect(device.gatt.connected).toBe(true);
    expect(BleClient.requestDevice).not.toHaveBeenCalled();
  });

  it.each(['powered off', 'out of range'])('retains the saved address when the scale is %s', async (reason) => {
    const initial = androidGatt(model);
    await initial.requestDevice();
    initial.remember();
    AndroidShell.hasBluetoothPermissions.mockResolvedValue({ granted: true });
    const device = await androidGatt(model, { reconnect: true }).requestDevice();
    BleClient.connect.mockRejectedValueOnce(new Error(reason));
    await expect(device.gatt.connect()).rejects.toThrow(reason);
    expect(device.gatt.connected).toBe(false);
    expect(rememberedAndroidScale(model)).toEqual(peripheral);
  });

  it('rejects stale connected state after a disconnect during native setup', async () => {
    BleClient.connect.mockImplementation(async (_id, onDisconnect) => onDisconnect());
    const device = await androidGatt(model).requestDevice();
    await expect(device.gatt.connect()).rejects.toThrow('disconnected');
    expect(device.gatt.connected).toBe(false);
    expect(BleClient.getServices).not.toHaveBeenCalled();
  });

  it('does not fail an already usable connection if Android WebView storage is unwritable', async () => {
    localStorage.setItem = () => { throw new Error('storage unavailable'); };
    const adapter = androidGatt(model);
    const device = await adapter.requestDevice();
    await device.gatt.connect();
    expect(() => adapter.remember()).not.toThrow();
    expect(device.gatt.connected).toBe(true);
    expect(rememberedAndroidScale(model)).toBeNull();
  });

  it('closes a connection that finishes after the workflow cancels it', async () => {
    const attempt = new AbortController();
    const device = await androidGatt(model, { signal: attempt.signal }).requestDevice();
    BleClient.connect.mockImplementation(async () => { attempt.abort(); });
    await expect(device.gatt.connect()).rejects.toMatchObject({ name: 'AbortError' });
    expect(device.gatt.connected).toBe(false);
    expect(BleClient.disconnect).toHaveBeenCalledWith(peripheral.deviceId);
  });
});
