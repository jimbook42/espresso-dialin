/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { PerfectShotCelebration } from './PerfectShotCelebration.jsx';

function renderCelebration(props = {}) {
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
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('uses pointer-events none on overlay layer', () => {
    const { container } = renderCelebration();
    const layer = container.querySelector('.perfect-shot-celebration-layer');
    expect(layer).toBeTruthy();
    expect(layer.style.pointerEvents).toBe('none');
  });

  it('removes via onComplete after timers', () => {
    const onComplete = vi.fn();
    renderCelebration({ onComplete });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('uses static cameo class without motion animation under reduced motion', () => {
    const { container } = renderCelebration();
    const cameo = container.querySelector('[data-testid="perfect-shot-cameo"]');
    expect(cameo.className).toContain('perfect-shot-cameo--static');
    expect(cameo.className).not.toContain('perfect-shot-cameo--enter');
  });
});
