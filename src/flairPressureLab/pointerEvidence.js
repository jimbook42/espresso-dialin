/** Experimental image-only shaft reader. Not imported by the application. */
import {pointerMerit} from './needleFromFrame.js';
import {NEEDLE_LOST_QUALITY,NEEDLE_LIKENESS_GATE,TIP_INNER_RATIO,OUTER_RADIUS_RATIO,wrap360,wrapDelta} from './gaugeConfig.js';
const SAMPLES=32;
/** The fitted shaft orientation and the hub-to-observed-tip ray are different
 * when the shaft misses the user's pivot. Keep both coordinate meanings. */
export function pointerTipRay(angleDeg,offsetPx,tipEnd,radius){
 if(![angleDeg,offsetPx,tipEnd,radius].every(Number.isFinite)||tipEnd<0||radius<=0)return null;
 const along=radius*(TIP_INNER_RATIO+(OUTER_RADIUS_RATIO-TIP_INNER_RATIO)*(tipEnd+.5)/SAMPLES);
 return wrap360(angleDeg+Math.atan2(offsetPx,along)*180/Math.PI);
}
function luma(image,x,y){x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=image.width||y>=image.height)return null;const i=(y*image.width+x)*4,d=image.data;return .299*d[i]+.587*d[i+1]+.114*d[i+2];}
function profile(image,cx,cy,radius,angle,offset,direction){
 const rad=angle*Math.PI/180,cos=Math.cos(rad),sin=Math.sin(rad),scale=Math.max(.35,Math.min(2.5,radius/90));
 const samples=new Float32Array(SAMPLES),widths=new Float32Array(SAMPLES);
 const residuals=new Float32Array(SAMPLES);
 for(let i=0;i<SAMPLES;i++){
  const r=radius*(TIP_INNER_RATIO+(OUTER_RADIUS_RATIO-TIP_INNER_RATIO)*(i+.5)/SAMPLES)*direction;
  const x=cx-sin*offset+cos*r,y=cy+cos*offset+sin*r;
  const values=[];for(let k=-8;k<=8;k++)values.push(luma(image,x-sin*k*scale,y+cos*k*scale));
  if(values.some(v=>v==null))continue;
  const center=Math.min(values[7],values[8],values[9]);
  const left=(values[0]+values[1]+values[2]+values[3])/4,right=(values[13]+values[14]+values[15]+values[16])/4;
  const side=Math.min(left,right),depth=side-center;
  if(depth<=5)continue; // Existing tip-valley contrast floor; no pressure-dependent evidence.
  const width=values.filter(v=>v<side-depth/2).length;
  if(width<2||width>8)continue; // Existing narrow-valley bounds, scaled with face resolution.
  // Locate the transverse ridge rather than rewarding any line that merely
  // passes through the same dark pixels. A tilted/offset line can otherwise
  // acquire false taper and a preferred direction on a symmetric shaft.
  let weight=0,moment=0;
  for(let k=0;k<17;k++)if(values[k]<side-depth/2){const w=side-values[k];weight+=w;moment+=w*(k-8);}
  residuals[i]=weight?(moment/weight)**2:0;
  samples[i]=depth;widths[i]=width;
 }
 const merit=pointerMerit({samples,probeAt:widths});
 let sum=0,residual=0,n=0;for(let i=0;i<=merit.end;i++)if(samples[i]>0){sum+=samples[i];residual+=residuals[i];n++;}
 return {...merit,samples,probeAt:widths,contrast:n?sum/n:0,residual:n?residual/n:0,coverage:n/SAMPLES};
}
function measure(image,hub,radius,angle,offset){
 const front=profile(image,hub.x,hub.y,radius,angle,offset,1),back=profile(image,hub.x,hub.y,radius,angle,offset,-1);
 const flip=back.merit>front.merit,tip=flip?back:front,tail=flip?front:back;
 return {angleDeg:wrap360(angle+(flip?180:0)),axisDeg:wrap360(angle)%180,offsetPx:flip?-offset:offset,
  tipEnd:tip.end,tailEnd:tail.end,tipMerit:tip.merit,tailMerit:tail.merit,coverage:tip.coverage,
  fitResidual:tip.residual,score:tip.merit*tip.contrast/(1+tip.residual),resolved:tip.merit>tail.merit+.02};
}
const axisGap=(a,b)=>Math.min(Math.abs(wrapDelta(a,b)),Math.abs(wrapDelta(a,b+180)));
function leaders(rows){const sorted=[...rows].sort((a,b)=>b.score-a.score),out=[];for(const row of sorted){if(out.every(r=>axisGap(r.axisDeg,row.axisDeg)>12))out.push(row);if(out.length===3)break;}return out;}
export function findPointerEvidence(image,hub,radius,{maxOffset=Math.max(4,Math.min(20,Math.ceil(radius*.09)*2))}={}){
 if(!image?.data||!hub||!(radius>12))return {angleDeg:null,quality:0,reason:'unreadable',candidates:[]};
 const coarse=[];for(let a=0;a<180;a+=4)for(let off=-maxOffset;off<=maxOffset;off+=4)coarse.push(measure(image,hub,radius,a,off));
 const refined=[];for(const peak of leaders(coarse)){
  for(let a=peak.axisDeg-4;a<=peak.axisDeg+4;a++)for(let off=-maxOffset;off<=maxOffset;off+=2)refined.push(measure(image,hub,radius,a,off));
 }
 const candidates=leaders(refined),best=candidates[0],second=candidates[1];
 if(!best||best.score<=0)return {angleDeg:null,quality:0,reason:'no-shaft',candidates};
 const margin=Math.max(0,(best.score-(second?.score??0))/best.score);
 const quality=margin*Math.min(1,best.coverage/NEEDLE_LIKENESS_GATE);
 const resolved=best.resolved&&quality>=NEEDLE_LOST_QUALITY;
 return {angleDeg:resolved?best.angleDeg:null,quality:resolved?quality:0,reason:resolved?'shaft':'ambiguous',margin,
  rayAngleDeg:resolved?pointerTipRay(best.angleDeg,best.offsetPx,best.tipEnd,radius):null,
  offsetPx:best.offsetPx,candidates};
}
