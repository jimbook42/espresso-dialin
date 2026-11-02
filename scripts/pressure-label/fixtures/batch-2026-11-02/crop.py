import cv2,json,sys
S=json.load(open('selection-notes.json')); H=json.load(open('hough.json'))
OV=json.load(open('crop-overrides.json')) if __import__('os').path.exists('crop-overrides.json') else {}
OUT=900; ROT={'20261024_124006':0,'20261017_084814':90,'20261018_160931':90,'20261018_160844':90}
import os; os.makedirs('zoom',exist_ok=True); man=[]
for s in S:
  i=s['id']; im=cv2.imread(f'upright/{i}.jpg'); h,w=im.shape[:2]
  cx,cy,r=OV.get(i) or H[i][0]; half=1.6*r
  x0=max(0,round(cx-half)); y0=max(0,round(cy-half)); side=round(2*half)
  side=min(side,w-x0,h-y0)
  cr=im[y0:y0+side,x0:x0+side]; sc=OUT/side
  rot=ROT.get(s['clip'],180); z=cv2.resize(cr,(OUT,OUT),interpolation=cv2.INTER_CUBIC)
  if rot==180: z=cv2.rotate(z,cv2.ROTATE_180)
  if rot==90: z=cv2.rotate(z,cv2.ROTATE_90_COUNTERCLOCKWISE)
  cv2.imwrite(f'zoom/{i}.jpg',z,[cv2.IMWRITE_JPEG_QUALITY,90])
  man.append(dict(id=i,file=f'{i}.jpg',clip=s['clip'],t=s['t'],phase=s['phase'],
    crop=dict(x=x0,y=y0,size=side,scale=sc,outSize=OUT,srcW=w,srcH=h,rotation=('ccw90' if rot==90 else 'r180' if rot==180 else 'none'),orientation='upright (ffmpeg autorotate applied)',source='override' if i in OV else 'hough')))
json.dump(man,open('zoom/manifest.json','w'),indent=1)
