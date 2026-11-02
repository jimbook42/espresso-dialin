/** On by default since v4.13.28. Opt out with VITE_ENABLE_NEEDLE_TRACKING=false (Vite)
 * or DIALIN_NEEDLE_TRACKING=0 (Node replay). */
export function needleTrackingEnabled(){
 // On by default (v4.13.28). Opt out: VITE_ENABLE_NEEDLE_TRACKING=false (Vite) or DIALIN_NEEDLE_TRACKING=0 (Node replay).
 if(import.meta.env?.VITE_ENABLE_NEEDLE_TRACKING==='false')return false;
 if(globalThis.process?.env?.DIALIN_NEEDLE_TRACKING==='0')return false;
 return true;
}
export const NEEDLE_TRACK_MAX_MISSES=3;
export function createNeedleTrack(){return {referenceAngleDeg:null,appearance:null,misses:0};}
export function missNeedleTrack(state,{lost=false}={}){
 state.misses++;
 if(lost||state.misses>=NEEDLE_TRACK_MAX_MISSES){state.referenceAngleDeg=null;state.appearance=null;}
}
export function rememberNeedleTrack(state,referenceAngleDeg,appearance){
 if(!appearance||!Number.isFinite(referenceAngleDeg))return;
 state.referenceAngleDeg=referenceAngleDeg;state.appearance=appearance;state.misses=0;
}
