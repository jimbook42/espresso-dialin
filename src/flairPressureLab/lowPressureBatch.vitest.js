import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

describe('November 3 low-pressure real-frame regression', () => {
  it('preserves main calibration behavior and creates a fresh output directory', () => {
    const temporary=mkdtempSync(path.join(tmpdir(),'espresso-low-pressure-'));
    const outputDir=path.join(temporary,'nested','out');
    try {
    const script=fileURLToPath(new URL('../../scripts/pressure-label/analysis/replay-low-pressure.mjs',import.meta.url));
    execFileSync(process.execPath,[script,'regression','--perturb','--labels-only','--regression','--output-dir',outputDir],
      {timeout:120000,stdio:'pipe'});
    const runs=JSON.parse(readFileSync(path.join(outputDir,'low-pressure-regression.json')));
    const initialHub=JSON.parse(readFileSync(new URL('../../scripts/pressure-label/fixtures/batch-2026-11-03/labels-orig.json',import.meta.url))).frames.c001.orig.hub;
    expect(runs.map(r=>r.spec.name)).toEqual(['true','hub-x-10','hub-y-10']);
    for(const run of runs){
      expect(run.rows,run.spec.name).toHaveLength(18);
      // These are main's measured limitations, not pressure corrections.
      const expectedFalseRest={'true':0,'hub-x-10':1,'hub-y-10':4};
      expect(run.summary.falseRest,run.spec.name).toBe(expectedFalseRest[run.spec.name]);
      if(run.spec.name==='true')expect(run.summary.median).toBeLessThanOrEqual(.3);
      else expect(run.summary.median).toBeGreaterThan(.3);
      expect(run.summary.recovered,run.spec.name).toBe(5);
      for(const row of run.rows.filter(r=>['c004','c005','c015','c016','c017'].includes(r.id))){
        expect(row.output.fresh,row.id).toBe(true);
        expect(row.read.pointerVerified,row.id).toBe(true);
      }
      if(run.spec.name==='hub-y-10') {
        // Main's 22-degree geometry check takes the snapped-hub path here.
        expect(run.calibration.userPlaced).toBe(false);
        expect(run.calibration.hub.y).not.toBe(initialHub[1]+run.spec.delta);
      } else {
        expect(run.calibration.userPlaced).toBe(true);
        expect(run.calibration.hub.x).toBe(initialHub[0]+(run.spec.axis==='x'?run.spec.delta:0));
        expect(run.calibration.hub.y).toBe(initialHub[1]);
      }
    }
    } finally { rmSync(temporary,{recursive:true,force:true}); }
  },130000);
});
