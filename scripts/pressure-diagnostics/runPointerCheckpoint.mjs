import fs from 'node:fs';
import {replay} from './wrongRayReplay.mjs';
import {candidateReplay} from './pointerCandidateReplay.mjs';
const baseline=JSON.parse(fs.readFileSync('docs/pressure-p2-endpoint-wide-arc-2026-11-02-results.json'));
for(const clip of baseline.clips){const result=await replay(clip.id,{candidate:candidateReplay()});fs.writeFileSync('scripts/needle-reader/out/wrong-ray-candidate-'+clip.id+'.json',JSON.stringify(result));console.log(JSON.stringify({id:clip.id,frames:result.rows.length,baselineVerified:result.baselineVerified,targets:result.rows.filter(r=>[19,40,25.25].includes(r.timeS)).map(r=>({t:r.timeS,...r.experiment.observation,angle:r.experiment.evidence.angleDeg,decision:r.experiment.evidence.reason}))}));}
