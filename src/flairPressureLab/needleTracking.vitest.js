import {describe,it,expect} from 'vitest';
import {findPointerEvidence,capturePointerAppearance,trackPointerEvidence} from './pointerEvidence.js';
import {createNeedleTrack,missNeedleTrack,rememberNeedleTrack,NEEDLE_TRACK_MAX_MISSES} from './needleTracking.js';
import {createShotLabR7Publisher} from './shotLabR7Live.js';
import {wrapDelta} from './gaugeConfig.js';
const hub={x:110,y:110},radius=90;
function image(angle=40,{empty=false}={}){
 const width=240,height=240,data=new Uint8ClampedArray(width*height*4).fill(230),r=angle*Math.PI/180;
 if(!empty)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const dx=x-hub.x,dy=y-hub.y,a=dx*Math.cos(r)+dy*Math.sin(r),b=-dx*Math.sin(r)+dy*Math.cos(r);
   if((a>=18&&a<=78&&Math.abs(b)<=1.8)||(a<=-18&&a>=-42&&Math.abs(b)<=5)){
     const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=20;
   }
 }
 return {width,height,data};
}
function seed(){
 const frame=image(),evidence=findPointerEvidence(frame,hub,radius);
 expect(evidence.angleDeg).not.toBeNull();
 return capturePointerAppearance(frame,hub,radius,evidence.candidates[0]);
}
describe('image-supported needle tracking',()=>{
 it('measures a moved shaft from current pixels instead of returning the prior',()=>{
   const out=trackPointerEvidence(image(48),hub,radius,40,seed());
   expect(out.rayAngleDeg).not.toBeNull();
   expect(Math.abs(wrapDelta(out.rayAngleDeg,48))).toBeLessThan(3);
   expect(Math.abs(wrapDelta(out.rayAngleDeg,40))).toBeGreaterThan(4);
 });
 it('expires when current-frame support disappears, and immediately on pose loss',()=>{
   const state=createNeedleTrack();rememberNeedleTrack(state,40,seed());
   for(let i=0;i<NEEDLE_TRACK_MAX_MISSES;i++){
     const unsupported=trackPointerEvidence(image(40,{empty:true}),hub,radius,state.referenceAngleDeg,state.appearance);
     expect(unsupported.rayAngleDeg).toBeNull();expect(unsupported.quality).toBe(0);
     missNeedleTrack(state);
   }
   expect(state.appearance).toBeNull();expect(state.referenceAngleDeg).toBeNull();
   rememberNeedleTrack(state,40,seed());missNeedleTrack(state,{lost:true});
   expect(state.appearance).toBeNull();
 });
 it('does not flip identity onto the opposite end when that end is visible',()=>{
   const current=image(220),template=seed();
   expect(Math.abs(wrapDelta(findPointerEvidence(current,hub,radius).angleDeg,220))).toBeLessThan(3);
   expect(trackPointerEvidence(current,hub,radius,40,template).rayAngleDeg).toBeNull();
 });
 it('never publishes an unsupported tracked prediction as fresh or extends the display hold',()=>{
   const cal={hub,zeroAngleDeg:0,fiveAngleDeg:75,tenAngleDeg:160};
   const publisher=createShotLabR7Publisher(cal);publisher.beginShot(0);
   const read={ok:true,lost:false,fresh:true,bar:5,needleDeg:75,needleQuality:.8,tenDeg:160};
   expect(publisher.stepFrame({nowMs:0,read}).fresh).toBe(true);
   const evidence=trackPointerEvidence(image(40,{empty:true}),hub,radius,40,seed());
   const missing={...read,ok:false,fresh:false,bar:null,rawBar:null,needleDeg:evidence.rayAngleDeg,pointerVerified:false};
   for(const nowMs of [125,250,375])expect(publisher.stepFrame({nowMs,read:missing}))
     .toMatchObject({fresh:false,held:true,measuredAtMs:null,bar:5});
   expect(publisher.stepFrame({nowMs:500,read:missing}))
     .toMatchObject({fresh:false,held:false,measuredAtMs:null,bar:null});
 });
});
