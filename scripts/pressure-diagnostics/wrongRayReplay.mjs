/** Standalone diagnostics. Never imported by the application or the live exam. */
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {CLIPS_DIR,probe,decodeStill,streamFrames} from '../needle-reader/examLive.mjs';
import {calibrateFromTaps,createCalibratedTracker,readCalibratedFrame} from '../../src/flairPressureLab/tapCalibrate.js';
import {createShotLabR7Publisher} from '../../src/flairPressureLab/shotLabR7Live.js';
import {setOpenCvForTests} from '../../src/flairPressureLab/opencvRuntime.js';

// Exact unchanged hand-clip exam taps; never fitted to candidate results.
const handTaps={
 '20261024_124006':{centre:{x:290.5,y:396.3},five:{x:248.2,y:365.3},ten:{x:316.1,y:357.2}},
 '20261025_130022':{centre:{x:481,y:342.5},five:{x:522.8,y:375.6},ten:{x:453.3,y:381.7}},
};
export async function replay(id,{candidate=null,verify=true}={}) {
 let cv=createRequire(import.meta.url)('@techstark/opencv-js');if(cv.then)cv=await cv;setOpenCvForTests(cv);
 const file=path.join(CLIPS_DIR,id+'.mp4'),meta=probe(file),hand=!!handTaps[id];
 const side=hand?null:JSON.parse(fs.readFileSync(path.join(CLIPS_DIR,id+'.json')));
 let still=decodeStill(file,hand?1:side.tapCalibration.atSec??0,meta.width,meta.height);
 if(hand){const bytes=await sharp(Buffer.from(still.data),{raw:{width:meta.width,height:meta.height,channels:4}}).extract({left:0,top:280,width:720,height:720}).raw().toBuffer();still={width:720,height:720,data:new Uint8ClampedArray(bytes)};}
 const cal=calibrateFromTaps(still,hand?handTaps[id]:side.tapCalibration.anchors);assert.ok(cal.ok,id+': calibration');
 const tracker=createCalibratedTracker(cal.calibration),publisher=createShotLabR7Publisher(cal.calibration);publisher.beginShot(0);
 const expected=verify?JSON.parse(fs.readFileSync('scripts/needle-reader/out/exam-observed/'+id+'.json')).observations:null;
 const rows=[];
 for await(const {timeS,image} of streamFrames(file,hand?720:meta.width,hand?720:meta.height,hand?'crop=720:720:0:280,fps=8':'fps=8')){
  const evidence={},read=readCalibratedFrame(image,tracker,evidence),observation=publisher.stepFrame({nowMs:timeS*1000,read});
  if(expected){const old=expected[rows.length];assert.equal(old.nowMs,timeS*1000);assert.equal(observation.fresh,old.observation.fresh,id+': fresh @'+timeS);assert.equal(observation.held,old.observation.held,id+': held @'+timeS);if(old.observation.bar==null)assert.equal(observation.bar,null);else assert.ok(Math.abs(observation.bar-old.observation.bar)<1e-9,id+': bar @'+timeS);}
  const experiment=candidate?candidate({image,read,calibration:cal.calibration,timeS}):null;
  rows.push({timeS,read,evidence,observation,experiment});
 }
 if(expected)assert.equal(rows.length,expected.length);
 return {id,calibration:cal.calibration,baselineVerified:!!expected,rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const ids=process.argv.slice(2);assert.ok(ids.length,'Provide clip ids');
 for(const id of ids){const result=await replay(id);fs.writeFileSync('scripts/needle-reader/out/wrong-ray-trace-'+id+'.json',JSON.stringify(result));console.log(JSON.stringify({id,verifiedFrames:result.rows.length,targets:result.rows.filter(r=>[19,40,25.25].includes(r.timeS)).map(r=>({t:r.timeS,bar:r.observation.bar,source:r.evidence.source,detector:r.evidence.detector,template:r.evidence.template}))}));}
}
