/** Standalone pre-integration pressure mapping; shares production functions/config. */
import assert from 'node:assert/strict';
import {findPointerEvidence} from '../../src/flairPressureLab/pointerEvidence.js';
import {inverseDialAngle} from '../../src/flairPressureLab/dialRegistration.js';
import {barFromTapAnchors,endpointIsResolved,publishTapBar,pointDist} from '../../src/flairPressureLab/tapCalibrate.js';
import {NEEDLE_LOST_QUALITY,OUTER_RADIUS_RATIO} from '../../src/flairPressureLab/gaugeConfig.js';
import {createShotLabR7Publisher} from '../../src/flairPressureLab/shotLabR7Live.js';
function rawPressure(read,cal){
 if(read.lost||read.needleDeg==null||read.needleQuality<NEEDLE_LOST_QUALITY)return null;
 const pin=pointDist(cal.hub,cal.ten)*read.radius/cal.radius;
 if(!endpointIsResolved(read.needleDeg,read.zeroDeg,read.tenDeg,read.radius*OUTER_RADIUS_RATIO,pin))return null;
 return read.poseMatrix?barFromTapAnchors(inverseDialAngle(read.needleDeg,read.poseMatrix),cal.zeroAngleDeg,cal.fiveAngleDeg,cal.tenAngleDeg)
 :barFromTapAnchors(read.needleDeg,read.zeroDeg,read.fiveDeg,read.tenDeg);
}
export function candidateReplay(){
 let publisher=null,lastGood=null,calibration=null,baselineFrames=0;
 return ({image,read,calibration:cal,timeS})=>{
  if(!publisher){calibration=cal;publisher=createShotLabR7Publisher(cal);publisher.beginShot(0);}
  if(!read.duplicate){const baseline=rawPressure(read,calibration);if(read.rawBar==null)assert.equal(baseline,null,'baseline raw mapping @'+timeS);else assert.ok(Math.abs(baseline-read.rawBar)<1e-9,'baseline raw mapping @'+timeS);baselineFrames++;}
  const evidence=read.lost||read.duplicate?{angleDeg:null,quality:0,reason:read.lost?'pose-lost':'duplicate'}:findPointerEvidence(image,read.hub,read.radius);
  const next={...read,needleDeg:evidence.angleDeg,needleQuality:evidence.quality};
  const raw=rawPressure(next,calibration),bar=publishTapBar({bar:raw,needleDeg:next.needleDeg,tenDeg:read.tenDeg,previousBar:lastGood});
  if(bar!=null)lastGood=bar;
  Object.assign(next,{rawBar:raw,bar,ok:bar!=null,fresh:bar!=null&&bar===raw});
  const observation=publisher.stepFrame({nowMs:timeS*1000,read:next});
  return {evidence,read:next,observation,baselineFrames};
 };
}
