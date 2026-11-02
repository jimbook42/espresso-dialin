/** Experimental, off by default. Node replay and Vite build opt-ins are separate
 * from the pressure-lab entry flag; neither requires editing an env file. */
export function needleTrackingEnabled(){
 return import.meta.env?.VITE_ENABLE_NEEDLE_TRACKING==='true'
   ||globalThis.process?.env?.DIALIN_NEEDLE_TRACKING==='1';
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
