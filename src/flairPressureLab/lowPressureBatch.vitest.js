import {describe, expect, it} from 'vitest';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

describe('November 3 low-pressure real-frame regression', () => {
  it('preserves valid low-pressure readings and withholds unverified perturbed calibrations', () => {
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
      expect(run.summary.falseRest,run.spec.name).toBe(0);
      if(run.spec.name==='true') {
        expect(run.summary.median).toBeLessThanOrEqual(.3);
        expect(run.summary.recovered).toBe(5);
        for(const row of run.rows.filter(r=>['c004','c005','c015','c016','c017'].includes(r.id))){
          expect(row.output.fresh,row.id).toBe(true);
          expect(row.read.pointerVerified,row.id).toBe(true);
        }
      } else {
        // Main published false-rest measurements with these two pivot errors.
        expect(run.calibration.compatibility).toBe('uncertain');
        expect(run.summary.scored).toBe(0);
        for(const row of run.rows) {
          expect(row.output).toMatchObject({ bar:null, fresh:false, reason:'gauge-unverified' });
        }
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
