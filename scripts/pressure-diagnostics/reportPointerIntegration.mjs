import {createHash} from 'node:crypto';
import fs from 'node:fs';import assert from 'node:assert/strict';import {quantile} from '../needle-reader/metrics.mjs';
const history=JSON.parse(fs.readFileSync('docs/pressure-p2-endpoint-wide-arc-2026-11-02-results.json'));
const checkpoint=JSON.parse(fs.readFileSync('scripts/needle-reader/out/wrong-ray-before-production/checkpoint.json'));
const pct=(n,d)=>100*n/d;
function stats(hits){const shown=hits.filter(h=>h.published!=null&&h.truth!=null),vals=shown.map(h=>Math.abs(h.published-h.truth));return {scored:shown.length,within03:vals.filter(x=>x<=.3).length,medianAbsBar:quantile(vals,.5),wildPct:shown.length?pct(vals.filter(x=>x>1).length,shown.length):null,worst:shown.reduce((w,h)=>!w||Math.abs(h.published-h.truth)>Math.abs(w.error)?{timeS:h.t,error:h.published-h.truth}:w,null)};}
const current=JSON.parse(fs.readFileSync('scripts/needle-reader/out/exam-live.json'));
let all=[],freshHits=[],heldHits=[];
const clips=current.clips.map(official=>{
 const prior=history.clips.find(r=>r.id===official.id),{result,observations}=JSON.parse(fs.readFileSync('scripts/needle-reader/out/exam-observed/'+official.id+'.json'));
 assert.equal(result.frames.length,observations.length);let fresh=observations.filter(o=>o.observation.fresh),held=observations.filter(o=>o.observation.held),n=observations.length;
 assert.equal(fresh.length+held.length,result.frames.filter(f=>f.bar!=null).length);
 const a=stats(result.labelHits);assert.equal(a.scored,official.labelN);assert.ok(a.medianAbsBar==null||Math.abs(a.medianAbsBar-official.medianAbsBar)<.00051);
 const fh=result.labelHits.filter(h=>h.phase==='hand'||['tap-fresh','model-fresh'].includes(h.reason)),hh=result.labelHits.filter(h=>h.phase!=='hand'&&h.reason?.startsWith('held:'));
 all.push(...result.labelHits);freshHits.push(...fh);heldHits.push(...hh);
 const now={frames:n,coveragePct:official.coveragePct,freshFrames:fresh.length,heldFrames:held.length,gapFrames:n-fresh.length-held.length,freshPct:pct(fresh.length,n),heldPct:pct(held.length,n),gapPct:pct(n-fresh.length-held.length,n),...a,falseTen:official.falseTen,freshFalseTen:fresh.filter(o=>o.observation.bar>=9.95).length,heldFalseTen:held.filter(o=>o.observation.bar>=9.95).length,freshAccuracy:stats(fh),heldAccuracy:stats(hh),labelHits:result.labelHits};
 assert.equal(now.falseTen,now.freshFalseTen+now.heldFalseTen);return {id:official.id,baseline:prior.now,replay:checkpoint.clips.find(c=>c.id===official.id).diagnostic,now};
});
const totals=clips.reduce((t,r)=>{for(const k of ['frames','freshFrames','heldFrames','gapFrames','falseTen','freshFalseTen','heldFalseTen'])t[k]+=r.now[k];return t;},{frames:0,freshFrames:0,heldFrames:0,gapFrames:0,falseTen:0,freshFalseTen:0,heldFalseTen:0});
Object.assign(totals,{...stats(all),coveragePct:pct(totals.freshFrames+totals.heldFrames,totals.frames),freshPct:pct(totals.freshFrames,totals.frames),heldPct:pct(totals.heldFrames,totals.frames),gapPct:pct(totals.gapFrames,totals.frames),freshAccuracy:stats(freshHits),heldAccuracy:stats(heldHits)});
const targets={zeroFalseTen:totals.falseTen===0,wildUnder3:totals.wildPct<3,medianAtMostPoint115:totals.medianAbsBar<=.115,zeroWild:totals.wildPct===0,coverageAtLeast90:totals.coveragePct>=90};
const report={candidate:'production integration on 8ca8caa',sourceHashes:JSON.parse(fs.readFileSync('scripts/needle-reader/out/wrong-ray-integration-source-hashes.json','utf8').replace(/^\uFEFF/,'')),preintegrationOverall:checkpoint.overall,singleExam:true,targets,allTargetsMet:Object.values(targets).every(Boolean),overall:totals,officialOverall:current.overall,clips,baselineLimit:history.baselineLimit};
fs.writeFileSync('docs/pressure-wrong-ray-2026-11-02-results.json',JSON.stringify(report,null,2)+'\n');
const f=(x,d=2)=>x==null?'—':Number(x).toFixed(d),seq=(r,fn)=>[r.baseline,r.replay,r.now].map(fn).join(' / ');
const cover=['| Clip | Published % B / R / live | Fresh % B / R / live | Held % B / R / live | Gaps % B / R / live |','| --- | ---: | ---: | ---: | ---: |'];
const accuracy=['| Clip | Median bar B / R / live | Within 0.3 B / R / live | Worst signed bar B / R / live | >1 bar % B / R / live | False 10 B / R / live |','| --- | ---: | ---: | ---: | ---: | ---: |'];
for(const r of clips){cover.push(`| ${r.id} | ${seq(r,s=>f(s.coveragePct))} | ${seq(r,s=>f(s.freshPct))} | ${seq(r,s=>f(s.heldPct))} | ${seq(r,s=>f(s.gapPct))} |`);accuracy.push(`| ${r.id} | ${seq(r,s=>f(s.medianAbsBar,3))} | ${seq(r,s=>s.within03==null?'—':s.within03+'/'+s.scored)} | ${seq(r,s=>f(s.worst?.error,3))} | ${seq(r,s=>f(s.wildPct))} | ${seq(r,s=>String(s.falseTen))} |`);}

const special=clips.filter(c=>['20261018_094055','20261025_130022'].includes(c.id));
const points=special.map(c=>({id:c.id,hits:c.now.labelHits.filter(h=>c.id.endsWith('094055')?[19,40].includes(h.t):h.t===25)}));
const requestedTable=['| Clip | Time s | Published bar | Truth bar | Signed error | State |','| --- | ---: | ---: | ---: | ---: | --- |',...points.flatMap(c=>c.hits.map(h=>'| '+c.id+' | '+h.t+' | '+f(h.published,6)+' | '+f(h.truth,6)+' | '+f(h.published-h.truth,6)+' | '+(h.reason==='tap'?'fresh-derived display window':h.reason)+' |'))];
for(const source of report.sourceHashes)assert.equal(createHash('sha256').update(fs.readFileSync(source.Path)).digest('hex').toUpperCase(),source.Hash);
let agreementFrames=0;
for(const c of clips){const live=JSON.parse(fs.readFileSync('scripts/needle-reader/out/exam-observed/'+c.id+'.json'));const replay=JSON.parse(fs.readFileSync('scripts/needle-reader/out/wrong-ray-candidate-'+c.id+'.json'));assert.equal(live.observations.length,replay.rows.length);for(let i=0;i<live.observations.length;i++){const a=live.observations[i].observation,b=replay.rows[i].experiment.observation;assert.equal(a.fresh,b.fresh);assert.equal(a.held,b.held);assert.equal(a.bar==null,b.bar==null);if(a.bar!=null)assert.ok(Math.abs(a.bar-b.bar)<1e-9);agreementFrames++;}}
report.replayAgreement={frames:agreementFrames,changed:0,toleranceBar:1e-9};
fs.writeFileSync('docs/pressure-wrong-ray-2026-11-02-results.json',JSON.stringify(report,null,2)+'\n');
const sharp=totals.coveragePct<90||totals.wildPct>3;
const text=['# Wrong-ray production integration — 2 November 2026','',
'Branch **fix/pressure-wrong-ray**, integration on8ca8caa. Runtime was frozen and hashed before one unchanged live exam. No tuning or rerun followed the result. All3961 pressure/fresh/held outputs match the corrected replay, and frozen runtime hashes match. **All acceptance checks pass: '+report.allTargetsMet+'**. Sharp regression versus replay (coverage<90 or >1-bar errors>3%): **'+sharp+'**.','',
'## Live result','',
'Published coverage **'+f(totals.coveragePct)+'%** ('+f(totals.freshPct)+' fresh /'+f(totals.heldPct)+' held /'+f(totals.gapPct)+' gaps); median **'+f(totals.medianAbsBar,6)+' bar**; within0.3 **'+totals.within03+'/'+totals.scored+'**; >1-bar **'+f(totals.wildPct)+'%**; worst **'+f(totals.worst?.error,6)+' at'+totals.worst?.timeS+'s**; false-ten **'+totals.falseTen+' ('+totals.freshFalseTen+'fresh/'+totals.heldFalseTen+'held)**. Frames '+totals.freshFrames+'+'+totals.heldFrames+'+'+totals.gapFrames+'='+totals.frames+'.','',
'Isaac accepted a median up to approximately0.115 with zero >1-bar errors. Target checks: '+JSON.stringify(targets)+'.','',
'## Requested points','',requestedTable.join('\n'),'',
'## All12 clips','',
'B=v4.13.26 production baseline, R=geometrically corrected standalone replay, live=integrated production reader. Coverage includes held output; held readings remain excluded from the confident curve. Medians/worst values are bar. Hand-clip labelled results use the unchanged fresh-display window, not necessarily an instantaneous fresh observation at the exact label time. Exact hits, worst times, frame counts and fresh/held splits are in the companion JSON.','',cover.join('\n'),'',accuracy.join('\n'),'',
'## Integration','',
'- Nonlegacy measurement and recovery use the shared bounded-offset pointer reader and hub-to-observed-tip ray. Ambiguous geometric direction yields no candidate; template correlation cannot bypass the shared verification. The legacy path is retained.',
'- Only a geometrically verified ray on the calibrated domain, passing existing endpoint checks, updates the needle hint. Only a valid pressure can update last-good pressure. Duplicate pixels explicitly clear pointerVerified. Existing450ms hold/gap publisher and saved fresh/held separation remain.',
'- Same-frame model corroboration uses the verified pointer ray and the existing5-degree agreement band, so unverified template recovery cannot certify model pressure. No model weights/confidence threshold or calibration changes.',
'- Calibration taps/zero, registration implementation, endpoint guard and pressure thresholds/frozen config are unchanged. No scoring/exam/label/fixture edits, retraining, schema/data/auth/privacy/version/dependency changes.',
'',
'## Validation','',
'- Targeted reader/geometry/endpoint/publisher tests: **54 passed /54**. New state regression checks verified updates, duplicate invalidation and ambiguous candidates preserving prior hint/last-good pressure. Existing pivot-error and symmetric-shaft tests remain unchanged.',
'- npm run test:vitest: **452 passed, 2 failed, 1 skipped (455)**; files85 passed/3 failed/1 skipped (89). Only documented Python-dependent gaugeProfile/needleRectify and missing box-only temporalReplay fixture failures. No other failures.',
'- npm run build: **passed**, PWA service worker generated; existing large-chunk warnings remain.',
'- Exact requested unchanged live exam command ran **once**: node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live. The existing read-only observer captures result values/provenance; it changes no argument or returned pressure. Report counts/medians/false-ten splits were checked against official output. Timing under the observer is not a performance benchmark.',
'- Prior official outputs and preintegration checkpoint preserved under ignored out/wrong-ray-before-production. Raw logs: out/wrong-ray-integration-targeted.txt, -full-tests.txt, -build.txt, -exam.txt and -progress.txt. Runtime file hashes recorded before exam and verified before final commit.',
'',
'## Risks and stop','',
'No phone/hardware-camera latency benchmark was performed. The fitter scans multiple directions/offsets and its mobile CPU cost remains unverified. The unchanged exam private ONNX sampler provides legacy/unregistered metadata, so its nonlegacy published pressure primarily tests the pointer path; the live asynchronous model-corroboration path has not been newly exercised in-browser. Calibration consistency, including094055’s inherited zero, remains a residual accuracy limitation.','',
'New code: tapCalibrate.js integration/diagnostics, shotLabR7Needle.js corroboration, pointerEvidence.js production use, and reader state tests. Documentation/report/handover updated. No merge, main push or deployment. Stop here for review.'];
fs.writeFileSync('docs/pressure-wrong-ray-2026-11-02.md',text.join('\n')+'\n');
console.log(JSON.stringify({targets,sharp,overall:totals,points},null,2));

