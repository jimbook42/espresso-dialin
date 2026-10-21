import { describe, expect, it } from 'vitest';
import {
  resolveDefaultTransportKind,
  resolveEffectiveTransportKind,
} from './useTimemoreScale.js';

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
