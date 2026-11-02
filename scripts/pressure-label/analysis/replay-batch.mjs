/** Replay only the six labelled clips not covered by the ten full-frame exam streams.
 * Usage: node scripts/pressure-label/analysis/replay-batch.mjs
 * Fetch labels from 41f685b before running. No reader or saved calibration is modified.
 */
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {CLIPS_DIR,EXAM_IDS,probe,decodeStill,streamFrames} from '../../needle-reader/examLive.mjs';
import {setOpenCvForTests} from '../../../src/flairPressureLab/opencvRuntime.js';
import {calibrateFromTaps,createCalibratedTracker,readCalibratedFrame} from '../../../src/flairPressureLab/tapCalibrate.js';
import {createShotLabR7Publisher} from '../../../src/flairPressureLab/shotLabR7Live.js';
const require=createRequire(import.meta.url);
let cv=require('@techstark/opencv-js');
if(typeof cv?.then==='function')cv=await cv;
if(!cv.Mat)await new Promise(resolve=>{cv.onRuntimeInitialized=resolve;});
setOpenCvForTests(cv);
const batch=new URL('../fixtures/batch-2026-11-02/',import.meta.url);
const marks=JSON.parse(readFileSync(new URL('labels-orig.json',batch))).frames;
const notes=JSON.parse(readFileSync(new URL('selection-notes.json',batch)));
const handTaps={
 '20261024_124006':{centre:{x:290.5,y:676.3},five:{x:248.2,y:645.3},ten:{x:316.1,y:637.2}},
 '20261025_130022':{centre:{x:481,y:622.5},five:{x:522.8,y:655.6},ten:{x:453.3,y:661.7}},
};
const result=[];
for(const clip of new Set(notes.map(n=>n.clip))){
 if(EXAM_IDS.includes(clip))continue;
 const file=['','new','shot-2026-11-02'].map(d=>path.join(CLIPS_DIR,d,clip+'.mp4')).find(existsSync);
 if(!file)throw new Error('Missing clip '+clip);
 const dimensions=probe(file);
 const rows=notes.filter(n=>n.clip===clip&&!n.repeatOf);
 const first=rows.slice().sort((a,b)=>a.t-b.t)[0];
 const atSec=handTaps[clip]?1:first.t;
 const p=marks[first.id].orig;
 const point=a=>({x:a[0],y:a[1]});
 const taps=handTaps[clip]??{centre:point(p.hub),five:point(p.five),ten:point(p.ten)};
 const cal=calibrateFromTaps(decodeStill(file,atSec,dimensions.width,dimensions.height),taps);
 if(!cal.ok)throw new Error('Calibration failed '+clip+': '+cal.reason);
 const {template,needleTemplate,...smallCalibration}=cal.calibration;
 const series={clip,dimensions,atSec,taps,calibrationSource:handTaps[clip]?'exam hand taps translated from square crop (+280 y)':'first labelled rest hub/5/10; zero remains detected',
   labelCalibrationFrame:handTaps[clip]?null:first.id,calibration:smallCalibration,frames:[]};
 const tracker=createCalibratedTracker(cal.calibration);
 const publisher=createShotLabR7Publisher(cal.calibration);
 publisher.beginShot(0);
 // Matches exam hand path. The full-frame exam's r5 samples have no registered,
 // corroborated pose/timestamp and cannot be accepted by currentTapModel either.
 for await(const {timeS,image} of streamFrames(file,dimensions.width,dimensions.height)){
   const diag={};
   const read=readCalibratedFrame(image,tracker,diag);
   const out=publisher.stepFrame({nowMs:timeS*1000,read});
   series.frames.push({timeS,read,pointer:diag.pointer??null,
     output:{bar:out.bar,fresh:out.fresh,held:out.held,reason:out.reason,measuredAtMs:out.measuredAtMs}});
 }
 result.push(series);
 writeFileSync(new URL('../../needle-reader/out/batch-replayed.json',import.meta.url),JSON.stringify(result));
 console.log(clip,series.frames.length,'frames',series.calibrationSource);
}
