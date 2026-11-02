/** Reporting only; consumes saved standalone replay outputs, never changes scoring inputs. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {quantile} from '../needle-reader/metrics.mjs';
import {rollingDisplayBar} from '../../src/flairPressureLab/pressureDisplaySmoothing.js';
const baseline=JSON.parse(fs.readFileSync('docs/pressure-p2-endpoint-wide-arc-2026-11-02-results.json'));
const pct=(n,d)=>100*n/d;
function errors(hits){const shown=hits.filter(h=>h.published!=null&&h.truth!=null),values=shown.map(h=>Math.abs(h.published-h.truth));return {scored:shown.length,within03:values.filter(v=>v<=.3).length,medianAbsBar:quantile(values,.5),wildPct:shown.length?pct(values.filter(v=>v>1).length,shown.length):null,worst:shown.reduce((w,h)=>!w||Math.abs(h.published-h.truth)>Math.abs(w.error)?{timeS:h.t,error:h.published-h.truth}:w,null)};}
const medianLower=values=>[...values].sort((a,b)=>a-b)[Math.floor((values.length-1)/2)];
const priorCandidate=JSON.parse(fs.readFileSync('scripts/needle-reader/out/wrong-ray-before-bias/results.json'));
const biasDiagnosis=JSON.parse(fs.readFileSync('scripts/needle-reader/out/wrong-ray-bias-diagnosis.json'));
const all=[],clips=[];
for(const b of baseline.clips){
 const result=JSON.parse(fs.readFileSync('scripts/needle-reader/out/wrong-ray-candidate-'+b.id+'.json'));
 assert.equal(result.baselineVerified,true);assert.equal(result.rows.length,b.now.frames);
 const rows=result.rows.map(r=>({timeS:r.timeS,...r.experiment.observation})),fresh=rows.filter(r=>r.fresh),held=rows.filter(r=>r.held),n=rows.length;
 const samples=fresh.map(r=>({tS:r.timeS,bar:r.bar})),display=samples.map(s=>({timeS:s.tS,bar:rollingDisplayBar(samples,s.tS)}));
 const hits=b.now.labelHits.map(h=>{
  if(h.phase==='hand'){const window=display.filter(s=>Math.abs(s.timeS-h.t)<=.3);return {...h,published:window.length?medianLower(window.map(s=>s.bar)):null,reason:window.length?'diagnostic-fresh-display':'no-frame'};}
  const snap=rows.reduce((best,r)=>Math.abs(r.timeS-h.t)<Math.abs((best?.timeS??Infinity)-h.t)?r:best,null);
  return {...h,published:snap&&Math.abs(snap.timeS-h.t)<.08?snap.bar:null,reason:snap?.reason};
 });
 all.push(...hits.map(h=>({...h,clip:b.id})));
 const now={frames:n,freshFrames:fresh.length,heldFrames:held.length,gapFrames:n-fresh.length-held.length,coveragePct:pct(fresh.length+held.length,n),freshPct:pct(fresh.length,n),heldPct:pct(held.length,n),gapPct:pct(n-fresh.length-held.length,n),...errors(hits),falseTen:rows.filter(r=>r.bar>=9.95).length,freshFalseTen:fresh.filter(r=>r.bar>=9.95).length,heldFalseTen:held.filter(r=>r.bar>=9.95).length,labelHits:hits};
 clips.push({id:b.id,baseline:b.now,previousDiagnostic:priorCandidate.clips.find(c=>c.id===b.id).diagnostic,diagnostic:now,checkpoints:result.rows.filter(r=>[19,25,25.25,40].includes(r.timeS)).map(r=>({timeS:r.timeS,baseline:r.observation.bar,candidate:r.experiment.observation,axisAngleDeg:r.experiment.evidence.angleDeg,rayAngleDeg:r.experiment.evidence.rayAngleDeg,decision:r.experiment.evidence.reason,rawBar:r.experiment.read.rawBar}))});
}
const total=clips.reduce((s,c)=>{for(const k of ['frames','freshFrames','heldFrames','gapFrames','falseTen','freshFalseTen','heldFalseTen'])s[k]+=c.diagnostic[k];return s;},{frames:0,freshFrames:0,heldFrames:0,gapFrames:0,falseTen:0,freshFalseTen:0,heldFalseTen:0});
Object.assign(total,{coveragePct:pct(total.freshFrames+total.heldFrames,total.frames),freshPct:pct(total.freshFrames,total.frames),heldPct:pct(total.heldFrames,total.frames),gapPct:pct(total.gapFrames,total.frames),...errors(all)});
const targets={coverage:total.coveragePct>=90,median:total.medianAbsBar<=.10019122776905132,wild:total.wildPct<3,falseTen:total.falseTen===0};
const report={candidate:'296b201',kind:'PRE-INTEGRATION DIAGNOSTIC; not live exam',productionBase:'f3e3db1',baselineVerifiedFrames:total.frames,targets,overall:total,biasDiagnosis,previousOverall:priorCandidate.overall,clips};
fs.writeFileSync('docs/pressure-wrong-ray-2026-11-02-results.json',JSON.stringify(report,null,2)+'\n');
const f=(n,d=3)=>n==null?'—':Number(n).toFixed(d),pair=(c,fn)=>[c.baseline,c.previousDiagnostic,c.diagnostic].map(fn).join(' / ');
const table=['| Clip | Published % B / P / D | Fresh % B / P / D | Held % B / P / D | Gaps % B / P / D | Median B / P / D | Within .3 B / P / D | Worst B / P / D | >1 % B / P / D | False10 B / P / D |','| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',...clips.map(c=>`| ${c.id} | ${pair(c,s=>f(s.coveragePct,2))} | ${pair(c,s=>f(s.freshPct,2))} | ${pair(c,s=>f(s.heldPct,2))} | ${pair(c,s=>f(s.gapPct,2))} | ${pair(c,s=>f(s.medianAbsBar))} | ${pair(c,s=>s.within03+'/'+s.scored)} | ${pair(c,s=>f(s.worst?.error))} | ${pair(c,s=>f(s.wildPct,2))} | ${pair(c,s=>s.falseTen)} |`)];
const special=clips.filter(c=>['20261018_094055','20261025_130022'].includes(c.id));
const text=`# Wrong-ray pre-integration checkpoint — 2 November 2026

Branch fix/pressure-wrong-ray, from main f3e3db1 / v4.13.26. Step1 commit968e8bf adds non-invasive source diagnostics. Step2 candidate commit a41960b plus bias correction296b201 are experimental, not imported by production. Production bar mapping, calibration, registration, endpoint protection and publisher are unchanged. The step3 stash remains untouched.

## Single correction and tests

The initial candidate favored offset/tilted lines and falsely preferred a direction on symmetric shafts. The single authorized correction includes transverse dark-ridge centroid residual in candidate ranking. The later bias correction retains shaft orientation but supplies a separate hub-to-measured-tip ray for pressure mapping, using fitted offset and measured radial reach. No calibration, test or pressure threshold was changed. Targeted correction run: **47/47 passed** (6 experimental evidence,37 calibration,4 endpoint). Existing45 tests unchanged; two geometric projection regressions added. Pivot error remains<3 degrees; broad-tail pointer error now<3 degrees; equal-end shaft returns uncertainty. npm ci succeeded with local dependencies; the original shared junction target was preserved. No full suite/build/new official exam at this pre-integration checkpoint.

## Diagnostic replay (not an exam)

All12 real clips replayed. **${total.frames}/${total.frames}** production baseline frames exactly match saved bar/fresh/held outputs. The standalone pressure adapter additionally asserts raw-pressure equivalence frame-by-frame using existing mapper, inverse pose, endpoint check and calibration. Candidate has its own evidence and publisher state; it uses unchanged production pose/calibration only. No production integration. Candidate confidence, missing readings and pressure are never replaced by baseline values. Hand labels retain the existing fresh-display-window calculation. No label, score script, exam, fixture or frozen-config change.

Diagnostic totals: **${f(total.coveragePct,2)}%** published (${f(total.freshPct,2)} fresh /${f(total.heldPct,2)} held /${f(total.gapPct,2)} gaps), median **${f(total.medianAbsBar,6)}**, within.3 **${total.within03}/${total.scored}**, >1 bar **${f(total.wildPct,2)}%**, worst **${f(total.worst?.error,6)} at${total.worst?.timeS}s**, false10 **${total.falseTen} (${total.freshFalseTen} fresh /${total.heldFalseTen} held)**. Frames${total.freshFrames}+${total.heldFrames}+${total.gapFrames}=${total.frames}. Targets: ${JSON.stringify(targets)}.

B=preserved v4.13.26 production baseline; P=previous step2 candidate; D=geometrically corrected standalone candidate diagnostic. These are not claims of production/live improvement.

${table.join('\n')}

## Requested checkpoints

${special.map(c=>c.id+'\n\n'+JSON.stringify({checkpoints:c.checkpoints.filter(r=>c.id.endsWith('094055')?[19,40].includes(r.timeS):[25,25.25].includes(r.timeS)),scored:c.diagnostic.labelHits.filter(h=>c.id.endsWith('094055')?[19,40].includes(h.t):h.t===25)},null,2)).join('\n\n')}

## Limits and stop

The candidate is a standalone experiment. Fixed baseline pose isolates pointer identity; it does not validate changed feedback in an integrated tracker. Runtime latency/phone performance and model-corroboration behavior remain unverified. Calibration zero remains the baseline zero, including 094055's inconsistent span. Diagnostic failures/gaps are retained; no tuning after historical results. Existing production hint/last-good handling is not replaced. No deploy, merge, retraining, schema/data/auth/privacy or dependency/version changes. Full suite/build and one unchanged official exam belong to a separately approved integration phase.

The12-clip checkpoint is complete. Commit/push report and harness, update handover, and STOP before integration.
`;
fs.writeFileSync('docs/pressure-wrong-ray-2026-11-02.md',text);
console.log(JSON.stringify({targets,overall:total,checkpoints:special.map(c=>({id:c.id,frames:c.checkpoints,labelHits:c.diagnostic.labelHits.filter(h=>[19,25,40].includes(h.t))}))},null,2));

