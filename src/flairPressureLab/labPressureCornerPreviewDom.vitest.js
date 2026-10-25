/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest';
import {
  applyCornerPreviewVideoStyle,
  cornerPreviewVideoStyle,
  dialCropFromPose,
} from './labPressureCornerPreview.js';

const VIDEO = { videoW: 1280, videoH: 720 };
const BOX = { boxW: 80, boxH: 112 };

describe('applyCornerPreviewVideoStyle', () => {
  it('sets transform on the video element only', () => {
    const video = document.createElement('video');
    const wrapper = document.createElement('div');
    wrapper.appendChild(video);
    const style = cornerPreviewVideoStyle({
      ...VIDEO,
      ...BOX,
      crop: dialCropFromPose(900, 400, 40, VIDEO.videoW, VIDEO.videoH),
    });
    applyCornerPreviewVideoStyle(video, style);
    expect(video.style.transform).toMatch(/scale\(/);
    expect(wrapper.style.transform).toBe('');
  });
});
