// Recover labelled exam evidence from the single observed run, without rerunning it.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {CLIPS_DIR,EXAM_IDS,loadLabelRows,restOffsetDeg,mapLabelPoint,imageAngle,truthBarForLabel,probe} from '../../needle-reader/examLive.mjs';
import {rollingDisplayBar} from '../../../src/flairPressureLab/pressureDisplaySmoothing.js';
import {quantile} from '../../needle-reader/metrics.mjs';
export function baselineEvidence(observed){
 const labels=loadLabelRows(),hits=[];
 for(let i=0;i<EXAM_IDS.length;i++){
   const clip=EXAM_IDS[i],frames=observed[i].frames;
   const {storedW,storedH,rotation}=probe(path.join(CLIPS_DIR,clip+'.mp4'));
   const offset=restOffsetDeg(labels,clip);
   for(const l of labels.filter(l=>l.clip===clip)){
     const p=Object.fromEntries(['hub','tip','zero','ten'].map(k=>[k,mapLabelPoint(l[k],storedW,storedH,rotation)]));
     const mapped={...l,labelNeedle:imageAngle(p.hub,p.tip),labelZero:imageAngle(p.hub,p.zero),labelTen:imageAngle(p.hub,p.ten)};
     const snap=frames.reduce((best,f)=>!best||Math.abs(f.timeS-l.t)<Math.abs(best.timeS-l.t)?f:best,null);
     const published=snap&&Math.abs(snap.timeS-l.t)<.08?snap.output.bar:null;
     const truth=truthBarForLabel(mapped,offset);
     hits.push({clip,t:l.t,truth,published,error:published==null||truth==null?null:published-truth});
   }
 }
 for(const [j,clip] of ['20261024_124006','20261025_130022'].entries()){
   const hand=JSON.parse(readFileSync(path.join(CLIPS_DIR,'live-accuracy-evidence/livecheck/hand',`hand-${clip}.json`)));
   const raw=hand.rows||[];
   const rows=raw.length&&Array.isArray(raw[0])?raw.map(r=>({timeS:r[1],hand_bar:r[3]})):raw.filter(r=>r.timeS!=null&&r.hand_bar!=null);
   const samples=observed[10+j].frames.filter(f=>f.output.bar!=null&&!f.output.held&&f.output.fresh).map(f=>({tS:f.timeS,bar:f.output.bar}));
   const shown=samples.map(s=>({timeS:s.tS,bar:rollingDisplayBar(samples,s.tS)})).filter(s=>s.bar!=null);
   for(const r of rows){
     const window=shown.filter(s=>Math.abs(s.timeS-r.timeS)<=.3).map(s=>s.bar).sort((a,b)=>a-b);
     // examLive's medianOf selects the lower middle for an even-sized window.
     const published=window.length?window[Math.floor((window.length-1)/2)]:null;
     hits.push({clip,t:r.timeS,truth:r.hand_bar,published,error:published==null?null:published-r.hand_bar});
   }
 }
 const scored=hits.filter(h=>h.error!=null),errors=scored.map(h=>Math.abs(h.error));
 return {hits,scored:scored.length,within03:errors.filter(e=>e<=.3+1e-9).length,median:quantile(errors,.5),
   worst:scored.reduce((a,b)=>!a||Math.abs(b.error)>Math.abs(a.error)?b:a,null)};
}
