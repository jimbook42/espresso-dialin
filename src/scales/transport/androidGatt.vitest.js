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
