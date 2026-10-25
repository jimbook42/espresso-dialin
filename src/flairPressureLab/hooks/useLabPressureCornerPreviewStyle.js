import { useEffect, useRef, useState } from 'react';
import {
  cornerPreviewCropFromPose,
  cornerPreviewVideoStyle,
  smoothDialCrop,
} from '../labPressureCornerPreview.js';

const PREVIEW_BOX = { w: 80, h: 112 };

/**
 * Smoothed CSS for the corner preview video from throttled tracker pose samples.
 */
export function useLabPressureCornerPreviewStyle(previewPose, videoRef) {
  const smoothRef = useRef(null);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [style, setStyle] = useState(() =>
    cornerPreviewVideoStyle({ ...PREVIEW_BOX, videoW: 0, videoH: 0, crop: null }),
  );

  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return undefined;
    const sync = () => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (w && h) setVideoSize({ w, h });
    };
    sync();
    video.addEventListener('loadedmetadata', sync);
    video.addEventListener('resize', sync);
    return () => {
      video.removeEventListener('loadedmetadata', sync);
      video.removeEventListener('resize', sync);
    };
  }, [videoRef, previewPose]);

  useEffect(() => {
    if (!videoSize.w || !videoSize.h) return undefined;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const nowMs = Date.now();
      const target = cornerPreviewCropFromPose(previewPose, videoSize.w, videoSize.h, nowMs);
      if (target) {
        smoothRef.current = smoothDialCrop(smoothRef.current, target);
      } else {
        smoothRef.current = null;
      }
      const crop = smoothRef.current;
      setStyle(
        cornerPreviewVideoStyle({
          videoW: videoSize.w,
          videoH: videoSize.h,
          boxW: PREVIEW_BOX.w,
          boxH: PREVIEW_BOX.h,
          crop,
          mirrored: false,
        }),
      );
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [previewPose, videoSize.w, videoSize.h]);

  return { style, videoSize };
}
