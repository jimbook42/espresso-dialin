import cv2,json,numpy as np
S=json.load(open('selection-notes.json')); out={}
for s in S:
  im=cv2.imread(f"upright/{s['id']}.jpg"); h,w=im.shape[:2]; k=720/min(h,w)
  sm=cv2.resize(im,(round(w*k),round(h*k))); g=cv2.medianBlur(cv2.cvtColor(sm,cv2.COLOR_BGR2GRAY),5)
  c=cv2.HoughCircles(g,cv2.HOUGH_GRADIENT,1.2,40,param1=120,param2=45,minRadius=50,maxRadius=200)
  out[s['id']]=None if c is None else [[float(v/k) for v in x] for x in c[0][:3]]
json.dump(out,open('hough.json','w'))
for i,v in out.items(): print(i, None if v is None else [tuple(round(a) for a in x) for x in v])
