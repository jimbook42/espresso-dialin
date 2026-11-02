/** Build the report from the single exam observation and six extra clip replays. */
import {readFileSync,writeFileSync} from 'node:fs';
import {EXAM_IDS,CLIPS_DIR,probe} from '../../needle-reader/examLive.mjs';
import path from 'node:path';
import {barFromTapAnchors} from '../../../src/flairPressureLab/tapCalibrate.js';
import {wrap360,wrapDelta,TIP_INNER_RATIO,OUTER_RADIUS_RATIO} from '../../../src/flairPressureLab/gaugeConfig.js';
import {quantile} from '../../needle-reader/metrics.mjs';
import {baselineEvidence} from './baseline-evidence.mjs';
const json=url=>JSON.parse(readFileSync(new URL(url,import.meta.url)));
const batch='../fixtures/batch-2026-11-02/';
const labels=json(batch+'labels-orig.json').frames, notes=json(batch+'selection-notes.json');
const manifest=json(batch+'frames/manifest.json');
const observed=json('../../needle-reader/out/exam-observed.json');
if(observed.length!==12)throw new Error('Expected 10 exam and 2 hand publisher streams, got '+observed.length);
const extra=json('../../needle-reader/out/batch-replayed.json');
if(extra.length!==6)throw new Error('Expected six extra full-frame streams');
const series=[...observed.slice(0,10).map((s,i)=>({...s,clip:EXAM_IDS[i],dimensions:probe(path.join(CLIPS_DIR,EXAM_IDS[i]+'.mp4')),calibrationSource:'existing exam sidecar taps',atSec:null})),...extra];
const rest=new Set(['rest','dry-rest','return-rest','used_1']);
const point=a=>({x:a[0],y:a[1]});
const angle=(h,p)=>wrap360(Math.atan2(p.y-h.y,p.x-h.x)*180/Math.PI);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const med=a=>quantile(a,.5);
const finite=a=>a.filter(Number.isFinite);
const sub=(a,b)=>a==null||b==null?null:a-b;
const geomBar=(n,z,f,t)=>barFromTapAnchors(n,z,f,t);
const marks=notes.map(n=>{
 const l=labels[n.id];
 if(!l?.orig||!['hub','tip','zero','five','ten'].every(k=>l.orig[k]?.length===2))throw new Error('Incomplete '+n.id);
 const p=Object.fromEntries(Object.entries(l.orig).map(([k,v])=>[k,point(v)]));
 const a=Object.fromEntries(['tip','zero','five','ten'].map(k=>[k,angle(p.hub,p[k])]));
 const crop=manifest.find(m=>m.id===n.id).crop;
 if(crop.orientation!=='upright (ffmpeg autorotate applied)')throw new Error('Wrong coordinates '+n.id);
 // Check the rounded orig coordinates against the manifest conversion.
 for(const k of ['hub','tip','zero','five','ten']){
   const [x,y]=l[k],O=crop.outSize-1;
   const [u,v]=crop.rotation==='r180'?[O-x,O-y]:crop.rotation==='ccw90'?[O-y,x]:[x,y];
   if(Math.abs(p[k].x-(crop.x+u/crop.scale))>.051||Math.abs(p[k].y-(crop.y+v/crop.scale))>.051)throw new Error('Coordinate mismatch '+n.id+' '+k);
 }
 return {...n,points:p,angles:a,rest:rest.has(n.phase),displayScale:crop.scale};
});
// The pin centre differs from a resting shaft. Reuse the evaluators' leave-one-
// clip-out rest offset, excluding repeat taps and the clip being evaluated.
const offsets=Object.fromEntries(series.map(s=>[s.clip,med(marks.filter(m=>m.clip!==s.clip&&m.rest&&!m.repeatOf).map(m=>wrapDelta(m.angles.zero,m.angles.tip)))]));
function truth(m){
 const z=wrap360(m.angles.zero+offsets[m.clip]);
 return {zero:z,geometric:geomBar(m.angles.tip,z,m.angles.five,m.angles.ten),
   pin:geomBar(m.angles.tip,m.angles.zero,m.angles.five,m.angles.ten)};
}
const streamSummaries=series.map(s=>{
 let lastFresh=null;
 for(const f of s.frames){
   if(f.output.fresh)lastFresh=f.output.measuredAtMs/1000;
   f.lastFreshS=lastFresh;
   f.state=f.output.bar==null?'gap':f.output.held?'held':'fresh';
   f.staleMs=f.state==='held'&&lastFresh!=null?(f.timeS-lastFresh)*1000:null;
 }
 const count=k=>s.frames.filter(f=>f.state===k).length;
 const runs=[];let start=null;
 for(let i=0;i<=s.frames.length;i++){
   if(i<s.frames.length&&s.frames[i].state==='gap'){if(start==null)start=i;}
   else if(start!=null){runs.push({startS:s.frames[start].timeS,endS:s.frames[i-1].timeS,durationS:(i-start)*.125});start=null;}
 }
 // Adjacent fresh samples only; no bridging gaps or held samples to claim smoothness.
 const second=[];
 for(let i=2;i<s.frames.length;i++){
   const a=s.frames.slice(i-2,i+1);
   if(a.every(f=>f.state==='fresh'))second.push(a[2].output.bar-2*a[1].output.bar+a[0].output.bar);
 }
 return {clip:s.clip,calibrationSource:s.calibrationSource,calibrationFrame:s.labelCalibrationFrame??null,atSec:s.atSec,
   calibration:{hub:s.calibration.hub,zeroAngleDeg:s.calibration.zeroAngleDeg,fiveAngleDeg:s.calibration.fiveAngleDeg,tenAngleDeg:s.calibration.tenAngleDeg},
   frames:s.frames.length,fresh:count('fresh'),held:count('held'),gaps:count('gap'),
   coveragePct:100*(count('fresh')+count('held'))/s.frames.length,
   heldAgeMedianMs:med(s.frames.map(f=>f.staleMs)),heldAgeMaxMs:Math.max(0,...finite(s.frames.map(f=>f.staleMs))),
   gapRuns:runs,freshSecondDifferenceRms:second.length?Math.sqrt(second.reduce((a,b)=>a+b*b,0)/second.length):null};
});
const rows=marks.map(m=>{
 const s=series.find(s=>s.clip===m.clip);
 if(!s)throw new Error('Missing replay '+m.clip);
 const snap=s.frames.reduce((best,f)=>!best||Math.abs(f.timeS-m.t)<Math.abs(best.timeS-m.t)?f:best,null);
 if(Math.abs(snap.timeS-m.t)>.08)throw new Error('No nearby frame '+m.id);
 const {read:r,pointer,output:o}=snap, tr=truth(m);
 const crop=manifest.find(f=>f.id===m.id).crop;
 const sourceScale={x:crop.srcW/s.dimensions.width,y:crop.srcH/s.dimensions.height};
 if(Math.abs(sourceScale.x-sourceScale.y)>.001)throw new Error('Unexpected anisotropic source/replay scale '+m.id);
 const toSource=p=>({x:p.x*sourceScale.x,y:p.y*sourceScale.y});
 const labelBar=tr.geometric;
 const best=pointer?.candidates?.[0];
 let tip=null;
 // Reconstruct the centre of the last observed pointer sample, not an invented
 // physical endpoint: this is exactly the radius used by pointerTipRay.
 if(pointer?.rayAngleDeg!=null&&best?.tipEnd>=0){
   const along=r.radius*(TIP_INNER_RATIO+(OUTER_RADIUS_RATIO-TIP_INNER_RATIO)*(best.tipEnd+.5)/32);
   const rad=best.angleDeg*Math.PI/180;
   tip=toSource({x:r.hub.x+Math.cos(rad)*along-Math.sin(rad)*best.offsetPx,
        y:r.hub.y+Math.sin(rad)*along+Math.cos(rad)*best.offsetPx});
   if(Math.abs(wrapDelta(angle(toSource(r.hub),tip),r.needleDeg))>1e-6)throw new Error('Reconstructed tip ray mismatch '+m.id);
 }
 const predRay=tip?angle(m.points.hub,tip):null;
 const tipBar=predRay==null?null:geomBar(predRay,tr.zero,m.angles.five,m.angles.ten);
 const atReaderZero=r.zeroDeg==null?null:geomBar(m.angles.tip,r.zeroDeg,m.angles.five,m.angles.ten);
 const zeroOnlyBias=sub(atReaderZero,tr.geometric);
 const radius=dist(m.points.hub,m.points.tip);
 const angularErrorDeg=r.needleDeg==null?null:wrapDelta(m.angles.tip,r.needleDeg);
 const angularTipPx=angularErrorDeg==null?null:2*radius*Math.sin(Math.abs(angularErrorDeg)*Math.PI/360);
 return {id:m.id,clip:m.clip,t:m.t,phase:m.phase,group:m.group,why:m.why,repeatOf:m.repeatOf??null,
   matchedTimeS:snap.timeS,timeDeltaMs:(snap.timeS-m.t)*1000,state:snap.state,reason:o.reason,
   readerBar:o.bar,labelBar,error:sub(o.bar,labelBar),phaseAssumedZeroBar:m.rest?0:tr.geometric,labelGeometricBar:tr.geometric,labelPinBar:tr.pin,
   staleMs:snap.staleMs,lastFreshS:snap.lastFreshS,
   labelAngles:m.angles,labelZeroCorrectedDeg:tr.zero,restOffsetLocoDeg:offsets[m.clip],
   readerZeroDeg:r.zeroDeg,zeroVsPinDeg:r.zeroDeg==null?null:wrapDelta(m.angles.zero,r.zeroDeg),
   readerFiveDeg:r.fiveDeg,readerTenDeg:r.tenDeg,
   zeroVsRestCorrectedDeg:r.zeroDeg==null?null:wrapDelta(tr.zero,r.zeroDeg),zeroOnlyBiasBar:zeroOnlyBias,
   zeroDiagnosticCorrectedBar:sub(o.bar,zeroOnlyBias),
   hubPx:r.hub?dist(toSource(r.hub),m.points.hub):null,readerHub:r.hub?toSource(r.hub):null,readerTipSample:tip,labelTip:m.points.tip,sourceScale,
   tipSampleErrorPx:tip?dist(tip,m.points.tip):null,angularTipErrorPx:angularTipPx,needleAngleErrorDeg:angularErrorDeg,
   tipGeometryBar:tipBar,tipGeometryErrorBar:sub(tipBar,tr.geometric),
   rawBar:r.rawBar,readerNeedleDeg:r.needleDeg,pointerReason:pointer?.reason??null,
   pointerQuality:pointer?.quality??null,poseLost:r.lost,duplicate:r.duplicate??false,
   displayScale:m.displayScale};
});
const pairs=marks.filter(m=>m.repeatOf).map(m=>{
 const first=marks.find(x=>x.id===m.repeatOf),a=truth(first),b=truth(m);
 return {first:first.id,repeat:m.id,clip:m.clip,hubPx:dist(first.points.hub,m.points.hub),
   tipPx:dist(first.points.tip,m.points.tip),
   needleAngleDeg:Math.abs(wrapDelta(first.angles.tip,m.angles.tip)),
   geometricBarDifference:Math.abs(b.geometric-a.geometric),
   pinBarDifference:Math.abs(b.pin-a.pin),
   hubDisplayAgreementPx:Math.hypot(labels[first.id].hub[0]-labels[m.id].hub[0],labels[first.id].hub[1]-labels[m.id].hub[1]),
   tipDisplayAgreementPx:Math.hypot(labels[first.id].tip[0]-labels[m.id].tip[0],labels[first.id].tip[1]-labels[m.id].tip[1])};
});
const stats=values=>{const v=finite(values);return {n:v.length,median:med(v),p90:quantile(v,.9),max:v.length?Math.max(...v):null};};
function summary(rs){
 const shown=rs.filter(r=>r.readerBar!=null&&r.labelBar!=null);
 const n=k=>rs.filter(r=>r.state===k).length;
 return {n:rs.length,fresh:n('fresh'),held:n('held'),gaps:n('gap'),coveragePct:100*(n('fresh')+n('held'))/rs.length,
   absoluteError:stats(shown.map(r=>Math.abs(r.error))),within03:shown.filter(r=>Math.abs(r.error)<=.3).length,
   heldAgeMs:stats(rs.map(r=>r.staleMs)),tipSampleErrorPx:stats(rs.map(r=>r.tipSampleErrorPx)),
   angularTipErrorPx:stats(rs.map(r=>r.angularTipErrorPx)),tipAbsBar:stats(rs.map(r=>r.tipGeometryErrorBar==null?null:Math.abs(r.tipGeometryErrorBar))),
   resolvedTipOffScale:rs.filter(r=>r.readerTipSample&&r.tipGeometryBar==null).map(r=>r.id),
   zeroAbsBiasBar:stats(rs.map(r=>r.zeroOnlyBiasBar==null?null:Math.abs(r.zeroOnlyBiasBar))),
   zeroDiagnosticAbsError:stats(shown.map(r=>r.zeroDiagnosticCorrectedBar==null?null:Math.abs(r.zeroDiagnosticCorrectedBar-r.labelBar))),
   reasons:Object.fromEntries([...new Set(rs.map(r=>r.reason))].map(k=>[k,rs.filter(r=>r.reason===k).length]))};
}
const unique=rows.filter(r=>!r.repeatOf);
const clipZero=series.filter(s=>marks.some(m=>m.clip===s.clip)).map(s=>{
 const rs=unique.filter(r=>r.clip===s.clip);
 return {clip:s.clip,calibrationZeroDeg:s.calibration.zeroAngleDeg,locoRestOffsetDeg:offsets[s.clip],
   zeroMinusPinDeg:stats(rs.map(r=>r.zeroVsPinDeg)),zeroMinusCorrectedRestDeg:stats(rs.map(r=>r.zeroVsRestCorrectedDeg)),
   signedZeroOnlyBiasBar:stats(rs.map(r=>r.zeroOnlyBiasBar)),
   absoluteZeroOnlyBiasBar:stats(rs.map(r=>r.zeroOnlyBiasBar==null?null:Math.abs(r.zeroOnlyBiasBar))),
   restRows:rs.filter(r=>rest.has(r.phase)).map(r=>r.id)};
});
const exam=json('../../needle-reader/out/exam-live.json');
const allExam=observed.flatMap(s=>s.frames),examN=allExam.length;
const baseline={...exam.overall,observedFrames:examN,
 fresh:allExam.filter(f=>f.output.fresh).length,held:allExam.filter(f=>f.output.held).length,
 gaps:allExam.filter(f=>f.output.bar==null).length,falseTen:allExam.filter(f=>f.output.bar!=null&&f.output.bar>=9.95).length};
baseline.labelEvidence=baselineEvidence(observed);
if(baseline.labelEvidence.scored!==baseline.labelN||Math.abs(baseline.labelEvidence.median-baseline.medianAbsBar)>.00051)throw new Error('Reconstructed exam evidence differs from saved exam');
const report={reader:{version:'4.13.27',commit:'a860912',labelCommit:'41f685b6e34cfb366cef45dd7c1a5ce1ef096964'},
 methodology:{coords:'labels-orig.json frames[id].orig; upright source px, no second rotation',
   sampling:'8 Hz chronological full-frame replay; nearest within 80 ms, actual deltas in rows',
   truth:'piecewise 0/5/10 through hand labels; zero=pin+leave-one-clip-out median signed rest shaft offset, unique frames only; phase does not override measured tip geometry',
   zeroDiagnostic:'replace only zero in label scale with reader zero at matched frame; error is signed bias. Subtracting this from published bar is diagnostic, not a rerun or a shippable improvement',
   tip:'last resolved shaft sample centre from pointerEvidence best candidate; source px includes endpoint extent error. Angular chord at labelled radius separately removes endpoint extent',
   repeats:'10 independent retaps of identical source frames; both upright source and display crop px; geometric bar difference without forcing rest to zero'},
 baseline,summaryAll62:summary(rows),summaryUnique52:summary(unique),
 summaryExisting:summary(unique.filter(r=>r.group==='existing')),summaryNew:summary(unique.filter(r=>r.group!=='existing')),
 repeatNoise:{pairs:10,hubSourcePx:stats(pairs.map(p=>p.hubPx)),tipSourcePx:stats(pairs.map(p=>p.tipPx)),
   hubDisplayPx:stats(pairs.map(p=>p.hubDisplayAgreementPx)),tipDisplayPx:stats(pairs.map(p=>p.tipDisplayAgreementPx)),bar:stats(pairs.map(p=>p.geometricBarDifference))},
 clipZero,streamSummaries,repeatPairs:pairs,rows};
report.ranking=[
 {rank:1,candidate:'B',name:'Needle tracking across frames',
  expectedGaps:'Largest direct opportunity: four needle-missing gaps / 52 unique frames; at most +7.69 coverage percentage points if all four are recovered. One pose-lost gap is outside this bound.',
  expectedSmoothness:'Eight held + four missing observations are candidates for genuine fresh evidence: at most 12/52 = 23.08 percentage points of freshness. Avoid plateau/lag then catch-up jumps. No numeric jitter improvement established.',
  expectedMedian:'Likely helps held-error tail more than median; eight held samples, maximum age 375 ms. A new quantitative median cannot be predicted from sparse labels.',
  risk:'Medium/high: wrong-end identity, drift onto print or bezel, false certainty across occlusion. Prediction must never become measured pressure.',
  firstTicket:'Add a behind-flag image-evidence tracker in registered dial coordinates; propagate prior tip/shaft and seek current-frame support, keep shaft-end identity, expire when support disappears. Preserve fresh/held/gap semantics and hold timeout. Run temporal clips, this frozen batch and one exam; no interpolation or relaxed safety gates.'},
 {rank:2,candidate:'A',name:'Continuous session zero through countdown until pressure onset',
  expectedGaps:'No demonstrated direct recovery of these five gaps: a scale offset does not supply a missing pointer or pose.',
  expectedSmoothness:'Improves common baseline consistency; must freeze before first pressure movement. It cannot remove mid-shot needle gaps or smooth jitter by itself.',
  expectedMedian:`Not demonstrated: median isolated zero bias ${report.summaryUnique52.zeroAbsBiasBar.median.toFixed(3)} bar; diagnostic subtraction changes shown median ${report.summaryUnique52.absoluteError.median.toFixed(3)} to ${report.summaryUnique52.zeroDiagnosticAbsError.median.toFixed(3)} (worse). Some early 094055 frames have large zero error; benefits are clip- and range-specific, not additive to other fixes.`,
  risk:'Medium: early pressurisation may be erased as zero. b030/b039 tagged rest are geometrically above rest, so phase name/countdown time is not rest evidence. Session confirmation and fresh image stability must govern eligibility; trust taps and freeze zero at onset.',
  firstTicket:'Collect confirmed-rest observations through the 3-2-1 countdown, estimate one robust session zero with uncertainty, then freeze at onset. Keep user 5/10 taps fixed. Add onset/false-rest/occlusion acceptance cases; no mid-shot rezero.'},
 {rank:3,candidate:'C',name:'Tip geometric precision',
  expectedGaps:'No demonstrated coverage gain from subpixel refinement alone. Off-scale/wrong-end cases need identity/evidence recovery, not endpoint polishing.',
  expectedSmoothness:'Potential smaller reduction in fresh-sample jitter; current angular chord median 2.34 source px is close to repeat tip disagreement 2.63 source px. Physical endpoint length errors inflate full-distance metrics.',
  expectedMedian:`Conditional tip geometry median |error| ${report.summaryUnique52.tipAbsBar.median.toFixed(3)} bar versus repeat geometric disagreement ${report.repeatNoise.bar.median.toFixed(3)} bar. These are different sample sets; subtracting them is not a forecast. A few hundredths bar may be worth testing, but no measured whole-reader median gain is established.`,
  risk:'Low/medium for refinement of a verified shaft; high if tuned on these 52 frames. Hub/tap noise and perspective can dominate. Avoid optimising the tip sample length when angular pressure is already correct.',
  firstTicket:'Refine the centreline-to-pivot ray only after shaft identity is verified; report angular and transverse residuals independently of tip extent. Validate on held-out clips and repeats before touching acceptance thresholds.'},
];
const fmt=(x,d=3)=>x==null?'—':Number(x).toFixed(d);
const cells=rs=>rs.map(x=>String(x).replaceAll('|','\\|')).join(' | ');
const table=(headers,rs)=>['| '+cells(headers)+' |','| '+headers.map(()=>'---').join(' | ')+' |',...rs.map(r=>'| '+cells(r)+' |')].join('\n');
const lines=[
 '# Label batch 2026-11-02 versus v4.13.27',
 '',
 'Analysis only. Reader: `a860912` (v4.13.27); immutable label source: `data/labels-2026-11-02` at `41f685b`. No reader, exam, scoring, configuration, model or label edits. This deliberately selected hard-case batch is not a population accuracy estimate.',
 '',
 'Recommend **B (needle tracking)** first, then **A (confirmed session zero through countdown)**, then **C (tip precision)**. Of 52 unique frames, 39 are fresh, 8 held and 5 gaps. Four gaps and all eight holds have needle-missing reasons; one gap is pose-lost. This is an opportunity count, not a promised recovery rate.',
 '',
 '## Method and limits',
 '',
 '- Use only `labels-orig.json.frames[id].orig`, checked against all 310 manifest coordinate conversions (within 0.051 source px). These are upright pixels. Cropped JPEGs are display references, not runtime inputs.',
 '- Source dimensions are checked against replay dimensions. b012’s labelled source is 2160×3840, while its local exam MP4 is 720×1280 upright: reader points are multiplied by 3 for native-pixel comparisons. Angles and bar do not change under this uniform scale. Every row retains sourceScale.',
 '- Replay source MP4s chronologically at 8 Hz, using unchanged tap reader and publisher. Existing exam full-frame streams come from the one required exam run. The two hand-exam clips are additionally replayed at full upright size using the same taps translated by +280 y from the exam square crop. They are a different evaluation view, not a repeat exam.',
 '- Four new clips have no usable saved taps. Calibrate at their first labelled rest/used_1 frame using that frame’s hub/5/10 only. Zero is detected by the existing calibration code. This is favourable calibration input and is disclosed separately; calibration frames are not independent validation of hub/scale placement. That fixed calibration is supplied before replay, which starts at 0 as in the exam. This protocol does not simulate obtaining taps live or validate countdown timing.',
 '- Nearest stream sample within 80 ms, matching exam/eval practice. New-shot label times are not generally on the 125 ms grid; per-row time difference is in JSON. This temporal mismatch can matter during fast ramps.',
 '- Label bar uses piecewise hand 0/5/10. A pin centre is not the resting needle centreline: add the median signed pin→rest-shaft angle from unique phase-tagged rest frames in OTHER clips (leave one clip out), following eval-calibrated’s approach. Keep all tagged rest taps in that robust estimate; no outlier removal. The median offset is about 6°, but tagged rest samples include b030 at 27.23° and b039 at 16.01°. Their tips show pressure above rest: phase names must not override geometry. Primary truth is geometric on EVERY frame; the old evaluator’s phase-assumed-zero and pin-only bars are retained as sensitivity fields. No fit against reader errors and no per-clip tuning.',
 '- This is an analysis truth convention, not a new zero policy. The agreed product policy remains one session zero with the existing “Does the gauge read 0 at rest?” confirmation as evidence, trusting user taps. Return-rest labels can describe imperfect return; inspect geometric values before treating them as an exact zero.',
 '- Fresh/held/gap comes from publisher flags, not equality of successive values. Held age is elapsed time since last fresh observation, not last rendered value. Gaps have no invented pressure.',
 '- Tip location is reconstructed from the last resolved shaft sample, including transverse offset. It is a sampled endpoint, not a subpixel physical endpoint. Both full endpoint distance and angle-only chord error at labelled radius are reported. Missing/ambiguous pointers remain missing. Tip bar error uses the labelled hub/scale, separating geometry from reader scale as far as possible.',
 '- Zero-only error uses reader zero against the labelled needle and labelled 5/10. It isolates a geometric bias; subtracting it from a held/published bar is only a diagnostic, not a measured improvement. Perspective, hub error, scale differences and temporal staleness prevent an exact causal decomposition.',
 '',
 '## Coverage, errors and holds',
 '',
 table(['Set','N','Fresh','Held','Gap','Shown %','Median |bar error|','≤0.3 bar'],[
   ['All labels',report.summaryAll62],['Unique source frames',report.summaryUnique52],['Existing unique',report.summaryExisting],['New unique',report.summaryNew]
 ].map(([name,s])=>[name,s.n,s.fresh,s.held,s.gaps,fmt(s.coveragePct,2),fmt(s.absoluteError.median),`${s.within03}/${s.absoluteError.n}`])),
 '',
 `Unique held ages: median ${fmt(report.summaryUnique52.heldAgeMs.median,0)} ms, maximum ${fmt(report.summaryUnique52.heldAgeMs.max,0)} ms. These selected-frame counts differ from time-weighted stream coverage. All 62 rows are kept; use 52 unique rows for inference.`,
 '',
 table(['Clip','Replay calibration','Frames','Fresh','Held','Gaps','Shown %','Max hold ms','Fresh Δ² RMS bar'],streamSummaries.filter(s=>marks.some(m=>m.clip===s.clip)).map(s=>[s.clip,s.calibrationSource,s.frames,s.fresh,s.held,s.gaps,fmt(s.coveragePct,2),fmt(s.heldAgeMaxMs,0),fmt(s.freshSecondDifferenceRms,4)])),
 '',
 'Fresh Δ² RMS uses only three adjacent fresh stream samples, with no bridging gaps. It contains true pressure acceleration as well as noise; sparse hand labels cannot establish a ground-truth smoothness score. Gap-run start/end/duration are in JSON.',
 '',
 '## Zero angle and isolated zero contribution',
 '',
 'Angles below are signed reader minus hand pin/rest direction in the matched source frame, so they account for moving gauge orientation. Calibration zero is in the initial calibration frame and should not be directly subtracted from a later source angle. The table reports medians; every row’s absolute angles and bar contribution are in JSON.',
 '',
 table(['Clip','Calibration zero °','LOCO pin→rest °','Reader−pin °','Reader−rest °','Zero-only signed bar','Zero-only |bar| median','Rest labels'],clipZero.map(z=>[z.clip,fmt(z.calibrationZeroDeg,2),fmt(z.locoRestOffsetDeg,2),fmt(z.zeroMinusPinDeg.median,2),fmt(z.zeroMinusCorrectedRestDeg.median,2),fmt(z.signedZeroOnlyBiasBar.median),fmt(z.absoluteZeroOnlyBiasBar.median),z.restRows.join(', ')||'none'])),
 '',
 `Across unique rows, median |zero-only bias| = ${fmt(report.summaryUnique52.zeroAbsBiasBar.median)} bar. On shown rows, subtracting that diagnostic contribution changes median |error| from ${fmt(report.summaryUnique52.absoluteError.median)} to ${fmt(report.summaryUnique52.zeroDiagnosticAbsError.median)} bar. It does not recover a missing observation and is not a prospective result.`,
 '',
 'Do not assign all error to A/B/C. At b006 (094055 @40s), reader−label is −0.686 bar, while tip-only error is −0.040 bar and zero-only bias is 0 on the piecewise >5 bar segment. Existing 5/10 calibration/pose mapping differs from this batch’s labels; neither zero nor tip precision alone explains that residual. At b004 @19s, −0.737 bar includes a 125 ms hold and the same scale discrepancy. The older exam’s −0.318/−0.349 errors use different labels/truth, not contradictory reader outputs. Reader bars stay 5.655 and 5.056. Keep calibration/pose provenance in the first ticket’s diagnostics.',
 '',
 '## Tip precision and repeat noise',
 '',
 `Unique resolved tip samples: n=${report.summaryUnique52.tipSampleErrorPx.n}; median endpoint distance ${fmt(report.summaryUnique52.tipSampleErrorPx.median,2)} source px (p90 ${fmt(report.summaryUnique52.tipSampleErrorPx.p90,2)}, worst ${fmt(report.summaryUnique52.tipSampleErrorPx.max,2)}); median angle-only chord ${fmt(report.summaryUnique52.angularTipErrorPx.median,2)} source px; median |tip geometry bar error| ${fmt(report.summaryUnique52.tipAbsBar.median)} bar (p90 ${fmt(report.summaryUnique52.tipAbsBar.p90)}, n=${report.summaryUnique52.tipAbsBar.n}). Resolved tips outside the hand scale (${report.summaryUnique52.resolvedTipOffScale.join(', ')}) have no valid bar error and are explicitly excluded only from that bar statistic; their large pixel errors remain. These conditional metrics exclude gaps without a resolved tip; they cannot show that tip precision alone fixes those gaps.`,
 '',
 table(['Repeat','Hub source px','Tip source px','Hub display px','Tip display px','Needle Δ°','Geometric Δbar'],pairs.map(p=>[`${p.first}/${p.repeat}`,fmt(p.hubPx,2),fmt(p.tipPx,2),fmt(p.hubDisplayAgreementPx,2),fmt(p.tipDisplayAgreementPx,2),fmt(p.needleAngleDeg,2),fmt(p.geometricBarDifference)])),
 '',
 `Repeat medians: hub ${fmt(report.repeatNoise.hubSourcePx.median,2)} / tip ${fmt(report.repeatNoise.tipSourcePx.median,2)} upright source px; hub ${fmt(report.repeatNoise.hubDisplayPx.median,2)} / tip ${fmt(report.repeatNoise.tipDisplayPx.median,2)} display px; |Δbar| ${fmt(report.repeatNoise.bar.median)} (p90 ${fmt(report.repeatNoise.bar.p90)}, max ${fmt(report.repeatNoise.bar.max)}). These are paired retap disagreement, not standard deviation or a guaranteed lower bound. The approximate 3/9 px context describes zoomed display pixels; do not compare it directly with native source px.`,
 '',
 '## Per-frame results',
 '',
 'Error = reader − label bar. Px are upright source pixels. Z bias is the zero-only diagnostic; tip Δbar compares the reconstructed tip with the label in the hand scale. Held readings do not have a fresh tip unless current image evidence resolves one. Full angles, matching times, raw observations and repeat markers are in JSON.',
 '',
 table(['ID','Clip','t s','Label','Reader','Error','State / reason','Age ms','Z bias bar','Tip px','Tip Δbar'],rows.map(r=>[r.id+(r.repeatOf?` (↔${r.repeatOf})`:''),r.clip,fmt(r.t),fmt(r.labelBar),fmt(r.readerBar),fmt(r.error),`${r.state}: ${r.reason}`,fmt(r.staleMs,0),fmt(r.zeroOnlyBiasBar),fmt(r.tipSampleErrorPx,2),fmt(r.tipGeometryErrorBar)])),
 '',
 '## Ranked next fixes: B → A → C',
 '',
 'Ranked for the stated goal of fewer gaps and smoother curves, not just single-frame median. Expected gains below are directions and observed opportunity ceilings, not fitted or measured improvements. They are not additive. There is no implementation/retraining experiment in this analysis.',
 '',
 ...report.ranking.flatMap(r=>[
   `### ${r.rank}. ${r.candidate}: ${r.name}`,'',
   `- Gaps: ${r.expectedGaps}`,
   `- Smoothness: ${r.expectedSmoothness}`,
   `- Median: ${r.expectedMedian}`,
   `- Risk: ${r.risk}`,
   `- First ticket: ${r.firstTicket}`,'',
 ]),
 'Specific B evidence: b004/b013/b014/b015/b025/b028/b048/b053 are held; b005/b011/b012/b026 are needle-missing gaps. b007 is pose-lost. Resolved wrong-end rays at b005 and b013 are about 130–136 source px from the hand tip and off the hand pressure scale; retaining shaft identity is more relevant there than a tiny endpoint refinement. b030/b039 demonstrate why A must stop at actual movement rather than a phase label.',
 '',
 'Unverified: prospective gain for any candidate, physical pressure independent of visual taps, dense truth curves and true jitter, live browser/countdown operation, camera/source equivalence for the high-resolution dry label, and generalisation beyond this deliberately selected batch. This analysis cannot certify a new algorithm. B is the recommended first ticket; keep the frozen baseline and labels unchanged.',
 '',
 '## Baseline sanity check and validation',
 '',
 `Single requested exam command: \`node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live\`. The out preloader imports the checked-in analysis observer. It wraps original functions without altering their calls or returned readings; no exam/score source edits. Exam stream coverage ${fmt(100*(baseline.fresh+baseline.held)/examN,2)}% (${fmt(100*baseline.fresh/examN,2)} fresh / ${fmt(100*baseline.held/examN,2)} held / ${fmt(100*baseline.gaps/examN,2)} gaps), labelled median ${fmt(baseline.medianAbsBar)} bar, ${baseline.labelEvidence.within03}/${baseline.labelN} within 0.3, worst signed error ${fmt(baseline.labelEvidence.worst.error)} bar at ${baseline.labelEvidence.worst.clip} @${baseline.labelEvidence.worst.t}s, false 10-bar stream count ${baseline.falseTen}. Exam uses its existing older-label truth/display conventions; do not compare its median directly with the new batch metric. The reconstructed hits are validated against the saved exam median and count.`,
 '',
 '- `npm ci`: passed; existing audit reports 25 vulnerabilities (3 low, 15 moderate, 5 high, 2 critical). No dependency changes.',
 '- `npm run test:vitest`: 452 passed, 2 failed, 1 skipped; files 85 passed, 3 failed, 1 skipped. Failures are exactly the allowed Python loader/rectify tests and Linux-only temporal replay missing raw-frames.json. No other test failures.',
 '- `npm run build`: passed. No production code edits.',
 '- Coordinate checks: 62 complete labels / 310 points; repeats 10; unique frames 52. Real data only; no retraining, pressure interpolation or hand-tuned readings.',
 '',
 '## Reproduce',
 '',
 'From a clean v4.13.27 analysis worktree (PowerShell):',
 '',
 '```powershell',
 'npm ci',
 'git fetch origin data/labels-2026-11-02',
 'git restore --source=41f685b -- scripts/pressure-label/fixtures/batch-2026-11-02',
 'New-Item -ItemType Directory -Force scripts/needle-reader/out | Out-Null',
 'Set-Content scripts/needle-reader/out/exam-observer.mjs "import \'../../pressure-label/analysis/exam-observer.mjs\';"',
 'node --import ./scripts/needle-reader/out/exam-observer.mjs scripts/needle-reader/exam.mjs --live',
 'node scripts/pressure-label/analysis/replay-batch.mjs',
 'node scripts/pressure-label/analysis/analyze-batch.mjs',
 '```',
 '',
 'MP4s remain local under `C:\\Users\\Isaac\\dialin-exam-clips` (or DIALIN_EXAM_CLIPS), including new/ and shot-2026-11-02/. Raw traces are ignored under scripts/needle-reader/out. Fetch the separate label branch for source labels/JPEGs; they are not duplicated in this analysis commit.',
];
writeFileSync(new URL('../../../docs/label-analysis-2026-11-02.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
writeFileSync(new URL('../../../docs/label-analysis-2026-11-02.md',import.meta.url),lines.join('\n')+'\n');
console.log(JSON.stringify({summary:report.summaryUnique52,repeat:report.repeatNoise,baseline},null,2));
