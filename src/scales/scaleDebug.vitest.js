import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  logUnknownTimemoreFrame,
  pushScaleDebugLine,
  resetScaleDebugForTests,
  subscribeScaleDebug,
} from './scaleDebug.js';

describe('logUnknownTimemoreFrame', () => {
  beforeEach(() => {
    resetScaleDebugForTests();
    vi.stubGlobal('window', {
      location: { search: '?scaleDebug=1' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('always logs at debug level', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logUnknownTimemoreFrame({ opcode: 1, cmdId: 9 });
    expect(debug).toHaveBeenCalledWith('[scale] unknown Timemore frame opcode=0x1 cmdId=0x9');
  });

  it('pushes diagnostics when scaleDebug URL flag is set', () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    const seen = [];
    subscribeScaleDebug((lines) => seen.push(lines));
    logUnknownTimemoreFrame({ opcode: 2, cmdId: 7 });
    expect(seen.at(-1)?.[0]).toContain('cmdId=0x7');
    pushScaleDebugLine('manual line');
    expect(seen.at(-1)?.[0]).toBe('manual line');
  });
});
