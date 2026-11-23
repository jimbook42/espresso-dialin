/** @vitest-environment happy-dom */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useAndroidKeepAwake } from './useAndroidKeepAwake.js';

const keepAwake = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./androidShell.js', () => ({ isAndroidApp: true, AndroidShell: { keepAwake } }));

function Surface(props) {
  useAndroidKeepAwake(props);
  return null;
}

it('bounds preparation, releases on background and finish, and keeps calibration/recording awake', () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const root = createRoot(document.createElement('div'));
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const render = (props) => act(() => root.render(createElement(Surface, props)));
  const last = (enabled) => expect(keepAwake).toHaveBeenLastCalledWith({ enabled });
  const prep = { active: false, preparationKey: 'dial:1', canPrepare: true };
  try {
    render(prep);
    last(true);
    vi.advanceTimersByTime(5 * 60 * 1000);
    last(false);
    document.dispatchEvent(new Event('pointerdown'));
    last(true);
    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event('visibilitychange'));
    last(false);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event('visibilitychange'));
    last(true);
    render({ ...prep, active: true, canPrepare: false });
    vi.advanceTimersByTime(10 * 60 * 1000);
    last(true);
    render({ ...prep, canPrepare: false });
    last(false);
    render(prep);
    last(false);
    document.dispatchEvent(new Event('keydown'));
    last(true);
    render({ preparationKey: null, canPrepare: false, active: false });
    last(false);
    render({ preparationKey: null, canPrepare: false, active: true });
    last(true);
  } finally {
    act(() => root.unmount());
    last(false);
    hidden.mockRestore();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
