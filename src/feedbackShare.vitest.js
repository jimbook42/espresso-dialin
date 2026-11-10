import { describe, expect, it, vi } from 'vitest';
import { feedbackMailto, prepareGaugeFeedback, prepareShotFeedback, shareFeedbackFiles } from './feedbackShare.js';
import { buildShotDiagnosticDocument } from './flairPressureLab/labShotReplayExport.js';
import { diagnosticsBuild } from './scales/shotDeviceDiagnostics.js';

describe('voluntary diagnostic sharing', () => {
  it('uses Diagnostics v2 for the selected historical shot with optional feedback and saved flow', async () => {
    const shot = {
      id: '12345678-rest', beanId: 'private', notes: 'private',
      labPressureCurve: [{ tS: 0, bar: 1 }], scaleFlowCurve: [{ tS: 0, flowGs: 2 }],
    };
    const result = prepareShotFeedback(shot, 'Scale interrupted');
    const [file] = result.files;
    const shared = JSON.parse(await file.text());
    const original = buildShotDiagnosticDocument(shot, shared.exportedAt);
    expect(shared).toEqual({ ...original, testerFeedback: 'Scale interrupted', savedScaleFlowCurve: shot.scaleFlowCurve });
    expect(shared.scaleDiagnostics.availability).toBe('unavailable');
    expect(shared.beanId).toBeUndefined();
    expect(shared.notes).toBeUndefined();
    expect(file.type).toBe('application/json');
    expect(result.title).toBe(`Espresso Dial-In shot 12345678 v${diagnosticsBuild.appVersion}`);
    expect(JSON.parse(await prepareShotFeedback(shot, '').files[0].text()).testerFeedback).toBeUndefined();
    expect(feedbackMailto(result.title, 'Scale interrupted & resumed')).toBe(
      `mailto:TullLabs@outlook.com?subject=${encodeURIComponent(result.title)}&body=Scale%20interrupted%20%26%20resumed`,
    );
  });

  it('validates file sharing and distinguishes cancellation from fallback', async () => {
    const payload = prepareShotFeedback({ id: 'one' }, '');
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareFeedbackFiles({ canShare: () => false, share }, payload)).toBe('fallback');
    expect(share).not.toHaveBeenCalled();
    expect(await shareFeedbackFiles({ canShare: () => true, share }, payload)).toBe('share');
    expect(share).toHaveBeenCalledWith(payload);
    share.mockRejectedValueOnce(new DOMException('', 'AbortError'));
    expect(await shareFeedbackFiles({ canShare: () => true, share }, payload)).toBe('cancelled');
  });

  it('allows optional clip feedback without a saved shot', async () => {
    const clip = new File(['clip'], 'test.mp4', { type: 'video/mp4' });
    const payload = prepareGaugeFeedback('light-pointer', 'White needle', clip);
    expect(payload.files[1]).toBe(clip);
    expect(JSON.parse(await payload.files[0].text())).toEqual({
      appVersion: diagnosticsBuild.appVersion,
      compatibility: { state: 'unsupported', reason: 'light-pointer' },
      testerFeedback: 'White needle',
    });
    expect(prepareGaugeFeedback('light-pointer', '', null).files).toHaveLength(1);
  });
});
