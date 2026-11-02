/** Diagnoses saved pre-correction outputs; never modifies frames, labels or readings. */
import fs from 'node:fs';
import {quantile} from '../needle-reader/metrics.mjs';
const previous=JSON.parse(fs.readFileSync('scripts/needle-reader/out/wrong-ray-before-bias/results.json'));
const delta=(a,b)=>(a-b+540)%360-180,median=a=>quantile(a,.5),pairs=[],clips=[];
for(const c of previous.clips){
 const trace=JSON.parse(fs.readFileSync('scripts/needle-reader/out/wrong-ray-before-bias/wrong-ray-candidate-'+c.id+'.json'));
 const sameRay=trace.rows.filter(r=>r.experiment.evidence.angleDeg!=null&&r.read.needleDeg!=null&&Math.abs(delta(r.experiment.evidence.angleDeg,r.read.needleDeg))<30).map(r=>({difference:delta(r.experiment.evidence.angleDeg,r.read.needleDeg),offset:r.experiment.evidence.offsetPx/r.read.radius}));
 pairs.push(...sameRay);
 const errors=c.diagnostic.labelHits.filter(h=>h.published!=null).map(h=>h.published-h.truth);
 clips.push({id:c.id,sameRayFrames:sameRay.length,medianAngleDifference:median(sameRay.map(p=>p.difference)),medianOffsetOverRadius:median(sameRay.map(p=>p.offset)),medianSignedBarError:median(errors),positiveErrors:errors.filter(e=>e>0).length,negativeErrors:errors.filter(e=>e<0).length});
}
const n=pairs.length,sx=pairs.reduce((s,p)=>s+p.difference,0),sy=pairs.reduce((s,p)=>s+p.offset,0),sxx=pairs.reduce((s,p)=>s+p.difference**2,0),syy=pairs.reduce((s,p)=>s+p.offset**2,0),sxy=pairs.reduce((s,p)=>s+p.offset*p.difference,0);
const result={source:'Saved pre-bias-correction candidate replay',cohort:'Both angles present and circular separation <30 degrees, excluding direction switches for angle comparison only. Pressure scores use all labels without this filter.',sameRayFrames:n,pearsonCorrelation:(n*sxy-sx*sy)/Math.sqrt((n*sxx-sx*sx)*(n*syy-sy*sy)),clips,previousOverall:previous.overall};
fs.writeFileSync('scripts/needle-reader/out/wrong-ray-bias-diagnosis.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
