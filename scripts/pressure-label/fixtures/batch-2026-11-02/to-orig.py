# Usage: python3 to-orig.py merged-labels.json > labels-orig.json
# Recomputes original upright-frame px from display (crop) px using zoom/manifest.json.
import json,sys
m={x['id']:x for x in json.load(open('/workspace/pl-state/batch-2026-11-02/zoom/manifest.json'))}
L=json.load(open(sys.argv[1]))
for fid,r in L.get('frames',{}).items():
  c=m[fid]['crop'];O=c['outSize']-1;r['orig']={}
  for k in ['hub','tip','zero','five','ten']:
    p=r.get(k)
    if not p: r['orig'][k]=p; continue
    x,y=p;u,v=x,y
    if c['rotation']=='r180':u,v=O-x,O-y
    elif c['rotation']=='ccw90':u,v=O-y,x
    r['orig'][k]=[round(c['x']+u/c['scale'],1),round(c['y']+v/c['scale'],1)]
  r['crop']=c
json.dump(L,sys.stdout,indent=1)
