/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PerfectShotCelebration } from './PerfectShotCelebration.jsx';
import {
  PERFECT_SHOT_CELEBRATION_MS,
  PERFECT_SHOT_CAMEO_FADE_OUT_LEAD_MS,
} from '../utils/perfectShot.js';

function mockMatchMedia(reduced) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function renderCelebration(props = {}, { reducedMotion = true } = {}) {
  mockMatchMedia(reducedMotion);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onComplete = vi.fn();
  act(() => {
    root.render(
      createElement(PerfectShotCelebration, {
        variant: 'suit',
        onComplete,
        ...props,
      }),
    );
  });
  return { container, root, onComplete };
}

describe('PerfectShotCelebration', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  describe('reduced motion', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('uses pointer-events none on cameo', () => {
      const { container } = renderCelebration();
      const cameo = container.querySelector('[data-testid="perfect-shot-cameo"]');
      expect(cameo).toBeTruthy();
      expect(cameo.style.pointerEvents).toBe('none');
    });

    it('uses static cameo class without motion animation under reduced motion', () => {
      const { container } = renderCelebration();
      const cameo = container.querySelector('[data-testid="perfect-shot-cameo"]');
      expect(cameo.className).toContain('perfect-shot-cameo--static');
      expect(cameo.className).not.toContain('perfect-shot-cameo--enter');
    });

    it('removes via onComplete at celebration duration', () => {
      const onComplete = vi.fn();
      renderCelebration({ onComplete });
      act(() => {
        vi.advanceTimersByTime(PERFECT_SHOT_CELEBRATION_MS - 1);
      });
      expect(onComplete).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('sanity: celebration duration is 4000 ms', () => {
      expect(PERFECT_SHOT_CELEBRATION_MS).toBe(4000);
    });
  });

  describe('full motion', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockMatchMedia(false);
    });

    it('still present at 3.9 s and removed at 4.0 s', () => {
      const onComplete = vi.fn();
      const { container } = renderCelebration({ onComplete }, { reducedMotion: false });
      act(() => {
        vi.advanceTimersByTime(3900);
      });
      expect(container.querySelector('[data-testid="perfect-shot-cameo"]')).toBeTruthy();
      expect(onComplete).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(onComplete).toHaveBeenCalledTimes(1);
    });

    it('applies exit class at totalMs - fadeOutLead and not before', () => {
      const exitAt = PERFECT_SHOT_CELEBRATION_MS - PERFECT_SHOT_CAMEO_FADE_OUT_LEAD_MS;
      const { container } = renderCelebration({}, { reducedMotion: false });
      const cameo = () => container.querySelector('[data-testid="perfect-shot-cameo"]');
      act(() => {
        vi.advanceTimersByTime(exitAt - 1);
      });
      expect(cameo().className).not.toContain('perfect-shot-cameo--exit');
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(cameo().className).toContain('perfect-shot-cameo--exit');
    });

    it('uses enter animation class initially', () => {
      const { container } = renderCelebration({}, { reducedMotion: false });
      const cameo = container.querySelector('[data-testid="perfect-shot-cameo"]');
      expect(cameo.className).toContain('perfect-shot-cameo--enter');
      expect(cameo.className).not.toContain('perfect-shot-cameo--static');
    });

    it('clears timers on unmount before onComplete', () => {
      const onComplete = vi.fn();
      const { root } = renderCelebration({ onComplete }, { reducedMotion: false });
      act(() => {
        root.unmount();
      });
      act(() => {
        vi.advanceTimersByTime(PERFECT_SHOT_CELEBRATION_MS);
      });
      expect(onComplete).not.toHaveBeenCalled();
    });
  });

  describe('yield ring follows celebration lifetime', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      mockMatchMedia(false);
    });

    function renderWithRing() {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      function Host() {
        const [active, setActive] = React.useState(true);
        return createElement(
          'div',
          null,
          createElement('div', {
            'data-testid': 'dial-yield-tile',
            className: active ? 'perfect-shot-yield-ring' : '',
          }),
          active
            && createElement(PerfectShotCelebration, {
              variant: 'suit',
              onComplete: () => setActive(false),
            }),
        );
      }

      act(() => {
        root.render(createElement(Host));
      });
      return { container, root };
    }

    it('keeps ring class at 3.9 s and removes at 4.0 s', () => {
      const { container } = renderWithRing();
      const tile = () => container.querySelector('[data-testid="dial-yield-tile"]');
      act(() => {
        vi.advanceTimersByTime(3900);
      });
      expect(tile().classList.contains('perfect-shot-yield-ring')).toBe(true);
      expect(container.querySelector('[data-testid="perfect-shot-cameo"]')).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(tile().classList.contains('perfect-shot-yield-ring')).toBe(false);
      expect(container.querySelector('[data-testid="perfect-shot-cameo"]')).toBeFalsy();
    });
  });
});
