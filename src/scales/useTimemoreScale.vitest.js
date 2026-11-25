/** @vitest-environment happy-dom */
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveDefaultTransportKind,
  resolveEffectiveTransportKind,
  useTimemoreScale,
} from './useTimemoreScale.js';

const mocks = vi.hoisted(() => ({
  android: true, remembered: new Set(), makeTransport: vi.fn(),
}));
vi.mock('../native/androidShell.js', () => ({ get isAndroidApp() { return mocks.android; } }));
vi.mock('../config/scaleFlag.js', () => ({ isScaleSimPickerEnabled: () => false }));
vi.mock('./transport/androidGatt.js', () => ({
  rememberedAndroidScale: (model) => mocks.remembered.has(model) ? { deviceId: '12:34:56:78:9A:BC' } : null,
}));
vi.mock('./transport/createBluetoothScaleTransport.js', () => ({
  createBluetoothScaleTransport: mocks.makeTransport,
}));

describe('useTimemoreScale transport defaults', () => {
  it('defaults to BLE when sim picker is not allowed (production)', () => {
    expect(resolveDefaultTransportKind(false)).toBe('ble');
  });

  it('defaults to sim when sim picker is allowed (dev / preview:scale)', () => {
    expect(resolveDefaultTransportKind(true)).toBe('sim');
  });

  it('never connects with sim when sim is not allowed', () => {
    expect(resolveEffectiveTransportKind('sim', false)).toBe('ble');
    expect(resolveEffectiveTransportKind('ble', false)).toBe('ble');
    expect(resolveEffectiveTransportKind('sim', true)).toBe('sim');
  });
});

describe('remembered scale workflow', () => {
  let root;
  let state;
  let props;
  let links;
  let setup;

  function Hook(options) {
    state = useTimemoreScale(options);
    return null;
  }

  async function render(patch, strict = false) {
    props = { ...props, ...patch };
    const hook = createElement(Hook, props);
    await act(async () => root.render(strict ? createElement(StrictMode, null, hook) : hook));
  }

  function makeLink(model, options) {
    let connected = false;
    const weights = new Set();
    const disconnects = new Set();
    const link = {
      model, options,
      isConnected: () => connected,
      emit: (weightG, timestampMs = Date.now()) => weights.forEach((onWeight) => onWeight({ weightG, timestampMs })),
      lose: () => {
        connected = false;
        for (const listener of [...disconnects]) listener();
      },
      connect: vi.fn(async () => {
        await setup?.(link);
        options.signal.throwIfAborted();
        connected = true;
        if (setup == null) link.emit(12);
      }),
      disconnect: vi.fn(async () => { connected = false; }),
      remember: vi.fn(() => mocks.remembered.add(model)),
      onWeight: (fn) => { weights.add(fn); return () => weights.delete(fn); },
      onDisconnect: (fn) => { disconnects.add(fn); return () => disconnects.delete(fn); },
      onTimer: () => () => {},
      tare: async () => {},
      startTimer: async () => {},
      stopTimer: async () => {},
    };
    links.push(link);
    return link;
  }

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    mocks.android = true;
    mocks.remembered.clear();
    mocks.makeTransport.mockReset().mockImplementation(makeLink);
    links = [];
    setup = undefined;
    props = { enabled: true, scaleDeviceId: 'timemore-dot', liveWorkflowEntry: 0, liveWorkflowActive: true };
    root = createRoot(document.createElement('div'));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('remembers manual pairing only after a decoded weight, then reconnects on cold Dial mount in Strict Mode', async () => {
    await render({});
    expect(links).toEqual([]);
    setup = async () => {};
    await act(async () => { void state.connect(); });
    expect(state.connectStatus).toBe('connecting');
    expect(mocks.remembered.size).toBe(0);
    await act(async () => links[0].emit(12));
    expect(state.connectStatus).toBe('connected');
    expect(state.liveWeightG).toBe(12);
    expect(links[0].options.reconnect).toBe(false);
    expect(mocks.remembered.has('timemore-dot')).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(document.createElement('div'));
    setup = undefined;
    await render({}, true);
    expect(links.map(({ options }) => options.reconnect)).toEqual([false, true]);
    expect(state.connectStatus).toBe('connected');
  });

  it('reconnects when a restored workflow is initially locked, once it becomes safe', async () => {
    mocks.remembered.add('timemore-dot');
    await render({ shotLocked: true });
    await act(async () => state.connect());
    expect(links).toHaveLength(0);
    await render({ shotLocked: false });
    expect(links).toHaveLength(1);
    expect(state.connectStatus).toBe('connected');
  });

  it('retries once per workflow return or foreground resume and keeps the identity after failure', async () => {
    mocks.remembered.add('timemore-dot');
    setup = async () => { throw new Error('Powered off or out of range'); };
    await render({ liveWorkflowActive: false });
    expect(links).toHaveLength(0);
    await render({ liveWorkflowActive: true });
    expect(links).toHaveLength(1);
    expect(state.connectStatus).toBe('error');
    expect(state.reconnect).toBeTypeOf('function');
    await render({ targetYieldG: 42 });
    expect(links).toHaveLength(1);
    await act(async () => document.dispatchEvent(new Event('dialin-android-paused')));
    setup = undefined;
    await act(async () => document.dispatchEvent(new Event('dialin-android-resumed')));
    expect(links).toHaveLength(2);
    expect(state.connectStatus).toBe('connected');
    await act(async () => links[1].lose());
    expect(state.connectStatus).toBe('idle');
    await render({ liveWorkflowActive: false });
    await render({ liveWorkflowActive: true });
    expect(links).toHaveLength(3);
  });

  it('honours a deliberate disconnect until the user retries', async () => {
    mocks.remembered.add('timemore-dot');
    await render({});
    await act(async () => state.disconnect());
    await render({ liveWorkflowEntry: 1 });
    await act(async () => {
      document.dispatchEvent(new Event('dialin-android-paused'));
      document.dispatchEvent(new Event('dialin-android-resumed'));
    });
    expect(links).toHaveLength(1);
    await act(async () => state.reconnect());
    expect(links).toHaveLength(2);
    expect(state.connectStatus).toBe('connected');
  });

  it('waits for an old model to close before opening the newly selected one', async () => {
    mocks.remembered.add('timemore-dot');
    mocks.remembered.add('bookoo-themis');
    await render({});
    let close;
    links[0].disconnect.mockImplementation(() => new Promise((resolve) => { close = resolve; }));
    await render({ scaleDeviceId: 'bookoo-themis', shotLocked: true });
    expect(links[0].disconnect).not.toHaveBeenCalled();
    await render({ shotLocked: false });
    expect(links).toHaveLength(1);
    await act(async () => close());
    expect(links.map(({ model }) => model)).toEqual(['timemore-dot', 'bookoo-themis']);
    expect(state.connectStatus).toBe('connected');
  });

  it('does not run concurrent attempts and cancels a pending setup when a shot starts', async () => {
    mocks.remembered.add('timemore-dot');
    let finish;
    setup = () => new Promise((resolve) => { finish = resolve; });
    await render({});
    await act(async () => state.connect());
    await render({ liveWorkflowEntry: 1 });
    expect(links).toHaveLength(1);
    await render({ shotLocked: true });
    expect(links[0].options.signal.aborted).toBe(true);
    await act(async () => finish());
    expect(state.connectStatus).toBe('idle');
    expect(links[0].remember).not.toHaveBeenCalled();
    expect(links[0].disconnect).toHaveBeenCalledOnce();
  });

  it('times out when services connect but no valid notifications arrive', async () => {
    vi.useFakeTimers();
    mocks.remembered.add('timemore-dot');
    setup = async () => {};
    await render({});
    expect(state.connectStatus).toBe('connecting');
    await act(async () => links[0].emit(NaN));
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(state.connectStatus).toBe('error');
    expect(links[0].disconnect).toHaveBeenCalledOnce();
    expect(links[0].remember).not.toHaveBeenCalled();
    expect(links).toHaveLength(1);
  });

  it('cancels in the background and queues one new attempt on foreground after cleanup', async () => {
    mocks.remembered.add('timemore-dot');
    let finish;
    setup = () => new Promise((resolve) => { finish = resolve; });
    await render({});
    await act(async () => document.dispatchEvent(new Event('dialin-android-paused')));
    expect(links[0].options.signal.aborted).toBe(true);
    await act(async () => document.dispatchEvent(new Event('dialin-android-resumed')));
    expect(links).toHaveLength(1);
    setup = undefined;
    await act(async () => finish());
    expect(links).toHaveLength(2);
    expect(state.connectStatus).toBe('connected');
  });

  it('retains the disconnected shot samples without appending to them on foreground', async () => {
    mocks.remembered.add('timemore-dot');
    await render({});
    await render({ shotLocked: true });
    await act(async () => state.notifyShotStarted({ tareAlreadyDone: true }));
    await act(async () => links[0].emit(3, Date.now() + 10));
    await act(async () => links[0].lose());
    await act(async () => {
      document.dispatchEvent(new Event('dialin-android-paused'));
      document.dispatchEvent(new Event('dialin-android-resumed'));
    });
    expect(links).toHaveLength(1);
    let stopped;
    await act(async () => { stopped = state.finalizeShotYieldSettle(); });
    expect(stopped.yieldG).toBeNull();
    expect(stopped.metrics.scaleFlowCurve.map(({ weightG }) => weightG)).toEqual([3]);
  });

  it('leaves Web Bluetooth manual and does not wait for a first weight there', async () => {
    mocks.android = false;
    mocks.remembered.add('timemore-dot');
    setup = async () => {};
    await render({});
    expect(state.reconnect).toBeUndefined();
    expect(links).toHaveLength(0);
    await act(async () => state.connect());
    expect(links[0].options.reconnect).toBe(false);
    expect(state.connectStatus).toBe('connected');
  });
});
