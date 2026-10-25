import { useEffect, useRef, useState } from 'react';
import {
  CORNER_PREVIEW_BOX,
  applyCornerPreviewVideoStyle,
  cornerPreviewCropFromPose,
  cornerPreviewStyleWriteKey,
  cornerPreviewVideoStyle,
  shouldWriteCornerPreviewStyle,
  smoothDialCrop,
} from '../labPressureCornerPreview.js';

/**
 * Smoothed crop for the corner preview video — DOM styles updated in rAF (not React state).
 */
export function useLabPressureCornerPreviewStyle(previewPose, videoRef) {
  const smoothRef = useRef(null);
  const lastWriteKeyRef = useRef('');
  const lastWriteMsRef = useRef(0);
  const syncedSizeRef = useRef({ w: 0, h: 0 });
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const video = videoRef?.current;
    if (!video) return undefined;
    const sync = () => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (
        w
        && h
        && (w !== syncedSizeRef.current.w || h !== syncedSizeRef.current.h)
      ) {
        syncedSizeRef.current = { w, h };
        setVideoSize({ w, h });
      }
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
      const video = videoRef?.current;
      if (!video) return;

      const nowMs = Date.now();
      const target = cornerPreviewCropFromPose(previewPose, videoSize.w, videoSize.h, nowMs);
      if (target) {
        smoothRef.current = smoothDialCrop(smoothRef.current, target);
      } else {
        smoothRef.current = null;
      }
      const crop = smoothRef.current;
      const style = cornerPreviewVideoStyle({
        videoW: videoSize.w,
        videoH: videoSize.h,
        boxW: CORNER_PREVIEW_BOX.w,
        boxH: CORNER_PREVIEW_BOX.h,
        crop,
        mirrored: false,
      });
      const key = cornerPreviewStyleWriteKey(style);
      if (shouldWriteCornerPreviewStyle(key, lastWriteKeyRef.current, nowMs, lastWriteMsRef.current)) {
        applyCornerPreviewVideoStyle(video, style);
        lastWriteKeyRef.current = key;
        lastWriteMsRef.current = nowMs;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      lastWriteKeyRef.current = '';
      lastWriteMsRef.current = 0;
    };
  }, [previewPose, videoRef, videoSize.w, videoSize.h]);

  return { videoSize };
}
