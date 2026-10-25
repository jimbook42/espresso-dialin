/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import React, { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PreShotDialStatus } from './PreShotDialStatus.jsx';
import { PRE_SHOT_DIAL_FOUND_LABEL, PRE_SHOT_DIAL_NOT_FOUND_LABEL } from '../flairPressureLab/preShotDialCheck.js';

function renderStatus(status) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(PreShotDialStatus, { status }));
  });
  return container;
}

describe('PreShotDialStatus', () => {
  it('renders nothing while checking', () => {
    const el = renderStatus('checking');
    expect(el.textContent).toBe('');
  });

  it('shows dial found copy before Start', () => {
    const el = renderStatus('found');
    expect(el.querySelector('[data-testid="pre-shot-dial-status"]').textContent).toBe(
      PRE_SHOT_DIAL_FOUND_LABEL,
    );
  });

  it('shows dial not found copy', () => {
    const el = renderStatus('not_found');
    expect(el.querySelector('[data-testid="pre-shot-dial-status"]').textContent).toBe(
      PRE_SHOT_DIAL_NOT_FOUND_LABEL,
    );
  });
});
