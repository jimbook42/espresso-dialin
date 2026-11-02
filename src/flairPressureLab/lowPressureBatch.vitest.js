import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

describe('November 3 low-pressure real-frame regression', () => {
  it('reads preinfusion without false rest under the reproduced pivot errors', () => {
    const script=fileURLToPath(new URL('../../scripts/pressure-label/analysis/replay-low-pressure.mjs',import.meta.url));
    execFileSync(process.execPath,[script,'regression','--perturb','--labels-only','--regression'],
      {timeout:120000,stdio:'pipe'});
    const runs=JSON.parse(readFileSync(new URL('../../scripts/needle-reader/out/low-pressure-regression.json',import.meta.url)));
    const initialHub=JSON.parse(readFileSync(new URL('../../scripts/pressure-label/fixtures/batch-2026-11-03/labels-orig.json',import.meta.url))).frames.c001.orig.hub;
    expect(runs.map(r=>r.spec.name)).toEqual(['true','hub-x-10','hub-y-10']);
    for(const run of runs){
      expect(run.rows,run.spec.name).toHaveLength(18);
      expect(run.summary.falseRest,run.spec.name).toBe(0);
      expect(run.summary.median,run.spec.name).toBeLessThanOrEqual(.3);
      expect(run.summary.recovered,run.spec.name).toBe(5);
      for(const row of run.rows.filter(r=>['c004','c005','c015','c016','c017'].includes(r.id))){
        expect(row.output.fresh,row.id).toBe(true);
        expect(row.read.pointerVerified,row.id).toBe(true);
      }
      // Modest finger error must not silently move the pivot to another circle.
      expect(run.calibration.hub.x).toBe(initialHub[0]+(run.spec.axis==='x'?run.spec.delta:0));
      expect(run.calibration.hub.y).toBe(initialHub[1]+(run.spec.axis==='y'?run.spec.delta:0));
    }
  },130000);
});
