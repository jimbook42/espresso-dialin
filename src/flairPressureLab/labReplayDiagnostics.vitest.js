import {describe, expect, it, vi} from 'vitest';
import {createLabReplayDiagnostics, commitReplayDiagnostics, replayDiagnosticsForShot} from './labReplayDiagnostics.js';
import {exportLabShotReplayDownloads} from './labShotReplayExport.js';

describe('export-only replay evidence', () => {
  it('captures the actual calibration and all publication states without treating holds as fresh', () => {
    const capture = createLabReplayDiagnostics();
    const cal = {hub:{x:10,y:20}, five:{x:30,y:40}, ten:{x:50,y:60},
      zeroAngleDeg:315, fiveAngleDeg:40, tenAngleDeg:120, userPlaced:true};
    capture.push({tS:.125, calibration:cal, fresh:true, bar:1.8, capturedAtSec:.1, measuredAtSec:.1});
    capture.push({tS:.25, calibration:cal, held:true, bar:1.8, reason:'held:needle-missing'});
    capture.push({tS:.75, calibration:cal, bar:null, reason:'needle-missing'});
    cal.hub.x = 99;
    const evidence = capture.snapshot();
    expect(evidence.calibrations).toHaveLength(1);
    expect(evidence.calibrations[0]).toMatchObject({atSec:.125, hub:{x:10,y:20}, placement:'user-placed'});
    expect(evidence.frames.map(f=>f.status)).toEqual(['fresh','held','gap']);
    expect(evidence.frames[1].measuredAtSec).toBeNull();
    expect(evidence.frames[2].bar).toBeNull();
    commitReplayDiagnostics('shot-a', evidence);
    capture.reset();
    expect(replayDiagnosticsForShot('shot-a').frames).toHaveLength(3);
    expect(replayDiagnosticsForShot('other-shot')).toBeNull();
    const exported = replayDiagnosticsForShot('shot-a');
    exported.calibrations[0].hub.x = 500;
    expect(replayDiagnosticsForShot('shot-a').calibrations[0].hub.x).toBe(10);
  });
  it('records recalibration with its shot-relative application time', () => {
    const capture = createLabReplayDiagnostics();
    capture.push({tS:0, calibration:{hub:{x:1,y:2}, userPlaced:false}});
    capture.push({tS:2, calibration:{hub:{x:3,y:4}, userPlaced:true}});
    expect(capture.snapshot().calibrations.map(c=>[c.atSec,c.placement])).toEqual([[0,'snapped'],[2,'user-placed']]);
  });
  it('downloads matching diagnostics with the video and explicitly marks unavailable evidence', async () => {
    const blobs=[];
    vi.stubGlobal('URL', {createObjectURL:blob=>{blobs.push(blob);return 'blob:replay';}, revokeObjectURL:()=>{}});
    vi.stubGlobal('document', {createElement:()=>({setAttribute:()=>{},click:()=>{}}),
      body:{appendChild:()=>{},removeChild:()=>{}}});
    try {
      const capture=createLabReplayDiagnostics();
      capture.push({tS:.125,calibration:{hub:{x:1,y:2},userPlaced:true,
        template:{red:new Float32Array([1,2]),dark:new Float32Array([3,4])}},fresh:true,bar:1.8});
      capture.push({tS:.25,held:true,bar:1.8});
      capture.push({tS:.75,bar:null});
      commitReplayDiagnostics('download-shot',capture.snapshot());
      const shot={id:'download-shot',labPressureCurve:[{tS:.125,bar:1.8}]};
      const original=JSON.stringify(shot);
      exportLabShotReplayDownloads({shot,blob:new Blob(['video'],{type:'video/mp4'})});
      const exported=JSON.parse(await blobs[1].text());
      expect(exported.readerDiagnosticsAvailability).toBe('current-session');
      expect(exported.readerDiagnostics.calibrations[0].template.red).toEqual([1,2]);
      expect(exported.readerDiagnostics.frames.map(f=>f.status)).toEqual(['fresh','held','gap']);
      expect(JSON.stringify(shot)).toBe(original);
      const missing=exportLabShotReplayDownloads({shot:{id:'old-shot'},blob:blobs[0]});
      expect(missing.readerDiagnostics).toBeNull();
      expect(missing.readerDiagnosticsAvailability).toContain('unavailable');
    } finally { vi.unstubAllGlobals(); }
  });
});
