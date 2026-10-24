import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindOverlayHistoryClose } from './useOverlayHistoryClose.js';

function installWindowMock() {
  const listeners = {};
  const windowMock = {
    history: {
      pushState: vi.fn(),
      back: vi.fn(() => {
        for (const handler of listeners.popstate || []) {
          handler(new Event('popstate'));
        }
      }),
      replaceState: vi.fn(),
    },
    addEventListener: (type, handler) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(handler);
    },
    removeEventListener: (type, handler) => {
      listeners[type] = (listeners[type] || []).filter((h) => h !== handler);
    },
    dispatchEvent: (event) => {
      for (const handler of listeners[event.type] || []) {
        handler(event);
      }
      return true;
    },
  };
  vi.stubGlobal('window', windowMock);
  return windowMock;
}

describe('bindOverlayHistoryClose', () => {
  let windowMock;

  beforeEach(() => {
    windowMock = installWindowMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pushes history on bind and pops on cleanup without calling onClose', () => {
    const onClose = vi.fn();
    const cleanup = bindOverlayHistoryClose(onClose);
    expect(windowMock.history.pushState).toHaveBeenCalled();
    cleanup();
    expect(windowMock.history.back).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when popstate fires (browser back)', () => {
    const onClose = vi.fn();
    const cleanup = bindOverlayHistoryClose(onClose);
    window.dispatchEvent(new Event('popstate'));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('navigates back on Escape while open', () => {
    const cleanup = bindOverlayHistoryClose(vi.fn());
    window.dispatchEvent({ type: 'keydown', key: 'Escape' });
    expect(windowMock.history.back).toHaveBeenCalled();
    cleanup();
  });
});
