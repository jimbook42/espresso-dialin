import fs from 'node:fs';
import { labelledBar } from '/tmp/dialin-rel/scripts/pressure-label/eval-labels.mjs';
const L = JSON.parse(fs.readFileSync('labels-orig.json','utf8')).frames;
const S = JSON.parse(fs.readFileSync('/workspace/newshots/2026-11-03b/lab-replay-87755a9b-pressure.json','utf8'));
const F = S.readerDiagnostics.frames;
const rows=[];
for (const [id,r] of Object.entries(L)) {
  const o=r.orig; const lb=labelledBar(o.hub,o.tip,o.zero,o.five,o.ten,+(process.env.OFF||0));
  const lab = typeof lb==='number'?lb:lb?.bar;
  const f=F.reduce((a,b)=>Math.abs(b.tS-r.t)<Math.abs(a.tS-r.t)?b:a);
  const err=f.bar==null||lab==null?null:f.bar-lab;
  rows.push({id,t:r.t,phase:r.phase,label:lab,reader:f.bar,status:f.status,dt:+(f.tS-r.t).toFixed(2),err});
}
const sum=(rs)=>{const e=rs.filter(x=>x.err!=null).map(x=>Math.abs(x.err)).sort((a,b)=>a-b);
 return {n:e.length,scoredOf:rs.length,median:e[Math.floor((e.length-1)/2)]/2+e[Math.ceil((e.length-1)/2)]/2,worst:e.at(-1),within03:e.filter(x=>x<=0.3).length,over1:e.filter(x=>x>1).length}};
for(const x of rows)console.log(x.id,x.t,x.phase,x.label?.toFixed(2),x.reader?.toFixed(2),x.status,x.dt,x.err?.toFixed(2));
console.log('ALL',sum(rows));console.log('PRE d001-d008',sum(rows.slice(0,8)));
fs.writeFileSync(`score-off${process.env.OFF||0}.json`,JSON.stringify({rows,all:sum(rows),pre:sum(rows.slice(0,8))},null,1));
