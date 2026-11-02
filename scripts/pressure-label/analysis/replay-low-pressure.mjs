/** Replay the live tap reader at 8 Hz and at every November 3 label time.
 * Labels provide only the initial hub/5/10 taps and independent scoring truth.
 * No subsequent label is supplied to the reader. */
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {probe,decodeStill} from '../../needle-reader/examLive.mjs';
import {setOpenCvForTests} from '../../../src/flairPressureLab/opencvRuntime.js';
import {calibrateFromTaps,createCalibratedTracker,readCalibratedFrame,barFromTapAnchors,pointAngle} from '../../../src/flairPressureLab/tapCalibrate.js';
import {createShotLabR7Publisher} from '../../../src/flairPressureLab/shotLabR7Live.js';
import {quantile} from '../../needle-reader/metrics.mjs';
const outputArg=process.argv.indexOf('--output-dir');
if(outputArg>=0&&!process.argv[outputArg+1])throw new Error('--output-dir requires a directory');
const outputDir=outputArg>=0?path.resolve(process.argv[outputArg+1])
 :fileURLToPath(new URL('../../needle-reader/out/',import.meta.url));
mkdirSync(outputDir,{recursive:true});
const require=createRequire(import.meta.url);
let cv=require('@techstark/opencv-js');
if(typeof cv?.then==='function')cv=await cv;
if(!cv.Mat)await new Promise(resolve=>{cv.onRuntimeInitialized=resolve;});
setOpenCvForTests(cv);
const batch=new URL('../fixtures/batch-2026-11-03/',import.meta.url);
const labels=JSON.parse(readFileSync(new URL('labels-orig.json',batch))).frames;
const notes=JSON.parse(readFileSync(new URL('selection-notes.json',batch)));
const file=fileURLToPath(new URL('source/lab-replay-a1efe497.mp4',batch));
const {width,height}=probe(file);
const point=a=>({x:a[0],y:a[1]});
const first=labels.c001.orig;
const initial=decodeStill(file,.3,width,height);
const rotate=(p,deg)=>{const h=point(first.hub),v=point(p),a=deg*Math.PI/180;return {x:h.x+(v.x-h.x)*Math.cos(a)-(v.y-h.y)*Math.sin(a),y:h.y+(v.x-h.x)*Math.sin(a)+(v.y-h.y)*Math.cos(a)};};
const specs=process.argv.includes('--perturb')?[
 {name:'true'},...['x','y'].flatMap(axis=>[-10,10].map(delta=>({name:`hub-${axis}${delta}`,axis,delta}))),
 ...[-25,-15,15,25].map(deg=>({name:`both-rays${deg}`,five:deg,ten:deg})),
 ...['five','ten'].flatMap(mark=>[-25,25].map(deg=>({name:`${mark}${deg}`,[mark]:deg}))),
]:[{name:'true'}];
const selected=process.argv.includes('--regression')?specs.filter(s=>['true','hub-x-10','hub-y-10'].includes(s.name)):specs;
const runs=selected.map(spec=>{
const centre=point(first.hub);if(spec.axis)centre[spec.axis]+=spec.delta;
const cal=calibrateFromTaps(initial,{centre,five:rotate(first.five,spec.five||0),ten:rotate(first.ten,spec.ten||0)});
if(!cal.ok)throw new Error('Calibration failed: '+cal.reason);
const tracker=createCalibratedTracker(cal.calibration);
// A persisted calibration has no transient optical-flow reference after reload.
if(process.argv.includes('--stored'))tracker.registration.reference=null;
const publisher=createShotLabR7Publisher(cal.calibration);publisher.beginShot(0);
const frames=[];
return {spec,cal,tracker,publisher,frames};
});
const times=[...new Set([...(process.argv.includes('--labels-only')?[]:Array.from({length:110},(_,i)=>i/8)),...notes.map(n=>n.t)])].sort((a,b)=>a-b);
for(const t of times){
 const image=decodeStill(file,t,width,height);
 for(const {tracker,publisher,frames} of runs){
 const diag={};
 const read=readCalibratedFrame(image,tracker,diag);
 const out=publisher.stepFrame({nowMs:t*1000,read});
 frames.push({t,read,pointer:diag.pointer,output:{bar:out.bar,displayBar:out.displayBar,fresh:out.fresh,held:out.held,reason:out.reason}});
 }
}
const results=runs.map(({spec,cal,frames})=>{
const rows=notes.map(n=>{
 const p=labels[n.id].orig,h=point(p.hub),a=k=>pointAngle(h,point(p[k]));
 const truth=barFromTapAnchors(a('tip'),a('zero'),a('five'),a('ten'));
 const f=frames.find(f=>f.t===n.t);
 return {id:n.id,t:n.t,truth,...f};
});
const errors=rows.filter(r=>r.output.bar!=null).map(r=>Math.abs(r.output.bar-r.truth)).sort((a,b)=>a-b);
const summary={scored:errors.length,median:quantile(errors,.5),falseRest:rows.filter(r=>r.truth>=1&&r.output.bar!=null&&r.output.bar<.6).length,recovered:rows.filter(r=>['c004','c005','c015','c016','c017'].includes(r.id)&&r.output.fresh).length};
const {template,needleTemplate,...calibration}=cal.calibration;
const result={spec,calibration,summary,rows,frames};
console.log(spec.name,JSON.stringify(summary));
console.table(rows.map(r=>({id:r.id,t:r.t,truth:r.truth?.toFixed(3),raw:r.read.rawBar?.toFixed(3),bar:r.output.bar?.toFixed(3),reason:r.pointer?.reason,lost:r.read.lost,hub:JSON.stringify(r.read.hub)})));
return result;
});
writeFileSync(path.join(outputDir,'low-pressure-'+(process.argv[2]||'latest')+'.json'),JSON.stringify(results));
