import {describe,it,expect} from 'vitest';
import {findPointerEvidence} from './pointerEvidence.js';
import {wrapDelta} from './gaugeConfig.js';
function dial({angle=40,hub={x:110,y:110},tail=0,symmetric=false}={}){
 const width=240,height=240,data=new Uint8ClampedArray(width*height*4).fill(230),rad=angle*Math.PI/180;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const dx=x-hub.x,dy=y-hub.y,along=dx*Math.cos(rad)+dy*Math.sin(rad),across=-dx*Math.sin(rad)+dy*Math.cos(rad);
 const dark=(along>=18&&along<=78&&Math.abs(across)<=1.8)||(along<=-18&&along>=-(symmetric?78:tail)&&Math.abs(across)<=(symmetric?1.8:5));
 if(dark){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=20;}
 }
 return {width,height,data};
}
describe('experimental shaft evidence',()=>{
 it('preserves shaft orientation with bounded pivot placement error',()=>{
 const result=findPointerEvidence(dial({hub:{x:112,y:92},tail:40}),{x:100,y:100},90,{maxOffset:18});
 expect(result.angleDeg).not.toBeNull();expect(Math.abs(wrapDelta(result.angleDeg,40))).toBeLessThan(3);
 });
 it('identifies the long thin pointer rather than its broad short tail',()=>{
 const result=findPointerEvidence(dial({angle:127,tail:42}),{x:110,y:110},90);
 expect(result.angleDeg).not.toBeNull();expect(Math.abs(wrapDelta(result.angleDeg,127))).toBeLessThan(3);
 });
 it('abstains when both ends have equal reach',()=>expect(findPointerEvidence(dial({symmetric:true}),{x:110,y:110},90).angleDeg).toBeNull());
 it('abstains on an empty face',()=>expect(findPointerEvidence(dial({hub:{x:-500,y:-500}}),{x:110,y:110},90).angleDeg).toBeNull());
});

import {pointerTipRay} from './pointerEvidence.js';
describe('shaft versus calibrated hub ray',()=>{
 it('projects the measured tip using the fitted lateral offset',()=>{
  const radius=90,end=24,along=radius*(.24+(.86-.24)*(end+.5)/32);
  expect(pointerTipRay(0,10,end,radius)).toBeCloseTo(Math.atan2(10,along)*180/Math.PI,10);
  expect(pointerTipRay(40,0,end,radius)).toBe(40);
  expect(pointerTipRay(40,-10,end,radius)).toBeLessThan(40);
 });
 it('preserves image scaling and the opposite-line offset convention',()=>{
  expect(pointerTipRay(40,8,24,90)).toBeCloseTo(pointerTipRay(40,16,24,180),10);
  expect(pointerTipRay(220,-8,24,90)).toBeCloseTo(220-Math.atan2(8,90*(.24+.62*24.5/32))*180/Math.PI,10);
  expect(pointerTipRay(40,8,-1,90)).toBeNull();
 });
});
