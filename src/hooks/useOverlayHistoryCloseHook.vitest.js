/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-dom/test-utils';
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useOverlayHistoryClose } from './useOverlayHistoryClose.js';

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

function TestApp({ isOpen, onClose, requestCloseRef }) {
  const requestClose = useOverlayHistoryClose(isOpen, onClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose, requestCloseRef]);
  return null;
}

function renderHookHost({ isOpen, onClose, requestCloseRef }) {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => {
    root.render(createElement(TestApp, { isOpen, onClose, requestCloseRef }));
  });
  return {
    rerender(nextOnClose) {
      act(() => {
        root.render(createElement(TestApp, { isOpen, onClose: nextOnClose, requestCloseRef }));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
    },
  };
}

describe('useOverlayHistoryClose', () => {
  let windowMock;

  beforeEach(() => {
    windowMock = installWindowMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not re-bind history when onClose identity changes while open', () => {
    const requestCloseRef = { current: null };
    const firstOnClose = vi.fn();
    const host = renderHookHost({ isOpen: true, onClose: firstOnClose, requestCloseRef });

    for (let i = 0; i < 20; i += 1) {
      host.rerender(vi.fn());
    }

    expect(windowMock.history.pushState).toHaveBeenCalledTimes(1);
    expect(windowMock.history.back).not.toHaveBeenCalled();
    expect(firstOnClose).not.toHaveBeenCalled();

    host.unmount();
  });

  it('closes exactly once via browser back (popstate)', () => {
    const requestCloseRef = { current: null };
    const onClose = vi.fn();
    const host = renderHookHost({ isOpen: true, onClose, requestCloseRef });

    act(() => {
      window.dispatchEvent(new Event('popstate'));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(windowMock.history.back).not.toHaveBeenCalled();

    host.unmount();
    expect(windowMock.history.back).not.toHaveBeenCalled();
  });

  it('closes exactly once via Escape', () => {
    const requestCloseRef = { current: null };
    const onClose = vi.fn();
    const host = renderHookHost({ isOpen: true, onClose, requestCloseRef });

    act(() => {
      window.dispatchEvent({ type: 'keydown', key: 'Escape' });
    });

    expect(windowMock.history.back).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    host.unmount();
    expect(windowMock.history.back).toHaveBeenCalledTimes(1);
  });

  it('closes exactly once via requestClose (close button)', () => {
    const requestCloseRef = { current: null };
    const onClose = vi.fn();
    const host = renderHookHost({ isOpen: true, onClose, requestCloseRef });

    act(() => {
      requestCloseRef.current();
    });

    expect(windowMock.history.back).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    host.unmount();
    expect(windowMock.history.back).toHaveBeenCalledTimes(1);
  });
});
