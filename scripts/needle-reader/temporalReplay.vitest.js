import { describe, expect, it } from 'vitest';
import { scorePhaseR4 } from './score_r4.mjs';
import { scorePhaseR4Repair } from './score_r4r1.mjs';

describe('phase R4 replay', () => {
  const report = scorePhaseR4();

  it('keeps the 094055 window, the wild rate, and the flip count on the chosen recovery', () => {
    expect(report.gates.wrong094055.result).toBe('PASS');
    expect(report.gates.wild.result).toBe('PASS');
    expect(report.gates.wild.wild).toBeLessThanOrEqual(5);
    expect(report.gates.flips.result).toBe('PASS');
    expect(report.gates.flips.flips).toBe(0);
    expect(report.gates.wild.n).toBe(94);
  });

  it('does not keep classical recovery when that column breaks wild or flips', () => {
    const classical = report.columns.a.labels;
    const breaks = classical.wild > 5 || classical.flips > 0;
    if (breaks) expect(report.chosen).not.toBe('a');
    else expect(report.chosen).toBe('a');
  });

  it('records live coverage on the eight clips outside 094055 and 225307', () => {
    const clips = Object.keys(report.gates.liveCoverage.clips);
    expect(clips).toHaveLength(8);
    expect(clips.some((id) => id.endsWith('094055') || id.endsWith('225307'))).toBe(false);
    expect(['PASS', 'FAIL']).toContain(report.gates.liveCoverage.result);
    expect(['GO', 'NO-GO']).toContain(report.verdict);
  });
});

describe('phase R4 repair 1', () => {
  const report = scorePhaseR4Repair();

  it('keeps pre-lock and the short hold, and drops the classical carry', () => {
    expect(report.kept).toEqual(['1', '3']);
    expect(report.gates.wrong094055.result).toBe('PASS');
    expect(report.gates.wrong094055.wrong).toBe(0);
    expect(report.gates.wild.result).toBe('PASS');
    expect(report.gates.wild.wild).toBeLessThanOrEqual(5);
    expect(report.gates.flips.flips).toBe(0);
    expect(report.gates.rest.rest).toBe(0);
    expect(report.columns.carry.labels.wild).toBeGreaterThan(5);
  });
});
