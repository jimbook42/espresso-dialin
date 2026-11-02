import json,subprocess,os
S=json.load(open('selection-notes.json')); os.makedirs('upright',exist_ok=True)
for s in S:
  subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',str(s['t']),'-i',s['source'],'-frames:v','1','-q:v','2','-y',f"upright/{s['id']}.jpg"],check=True)
