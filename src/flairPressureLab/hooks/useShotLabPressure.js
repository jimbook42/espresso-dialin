import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrontCameraStream } from './useFrontCameraStream.js';
import { PROCESS_INTERVAL_MS } from '../gaugeConfig.js';
import { createReadingHold } from '../frameQuality.js';
import {
  createCalibratedTracker,
  readCalibratedFrame,
} from '../tapCalibrate.js';
import { loadOpenCv } from '../opencvRuntime.js';
import {
  peakBarFromRaw,
  rollingDisplayBar,
} from '../pressureDisplaySmoothing.js';
import { createShotLabPressureSession } from '../shotLabPressureSession.js';
import { simulatedPressureBarAt } from '../shotPressureSimFeed.js';
import { isPressureSimAllowed } from '../../config/pressureSimFlag.js';

/**
 * Camera pressure during shots — isolated from scale/timer; errors are swallowed.
 *
 * @param {{
 *   enabled: boolean,
 *   timerRunning: boolean,
 *   timerSeconds: number,
 *   storedCalibration: object | null,
 *   onCalibrationSaved?: (calibration: object) => void,
 *   calibrateSheetOpen: boolean,
 * }} options
 */
export function useShotLabPressure({
  enabled,
  timerRunning,
  timerSeconds,
  storedCalibration,
  onCalibrationSaved,
  calibrateSheetOpen,
}) {
  const { videoRef, start, stop, status } = useFrontCameraStream();
  const sessionRef = useRef(createShotLabPressureSession());
  const holdRef = useRef(createReadingHold());
  const trackerRef = useRef(null);
  const qualityCanvasRef = useRef(null);
  const shotEpochRef = useRef(null);
  const simMode = isPressureSimAllowed();

  const [samples, setSamples] = useState([]);
  const [displayBar, setDisplayBar] = useState(null);
  const [hold, setHold] = useState({ held: false, gap: true });
  const [peakBar, setPeakBar] = useState(null);
  const [calibrated, setCalibrated] = useState(Boolean(storedCalibration));
  const [readerError, setReaderError] = useState('');

  useEffect(() => {
    setCalibrated(Boolean(storedCalibration));
    if (storedCalibration) {
      trackerRef.current = createCalibratedTracker(storedCalibration);
    } else {
      trackerRef.current = null;
    }
  }, [storedCalibration]);

  const shouldRunCamera =
    enabled && (calibrateSheetOpen || (timerRunning && calibrated && !simMode));

  useEffect(() => {
    if (!shouldRunCamera) {
      stop();
      return undefined;
    }
    let cancelled = false;
    loadOpenCv()
      .then(() => {
        if (!cancelled) void start();
      })
      .catch(() => {
        if (!cancelled) void start();
      });
    return () => {
      cancelled = true;
      stop();
    };
  }, [shouldRunCamera, start, stop]);

  const resetShotSession = useCallback(() => {
    sessionRef.current.reset();
    holdRef.current.reset();
    shotEpochRef.current = null;
    setSamples([]);
    setDisplayBar(null);
    setHold({ held: false, gap: true });
    setPeakBar(null);
    setReaderError('');
  }, []);

  useEffect(() => {
    if (!timerRunning) {
      resetShotSession();
      return;
    }
    sessionRef.current.begin();
    shotEpochRef.current = Date.now();
  }, [timerRunning, resetShotSession]);

  const grabSourceImage = useCallback((source) => {
    const width = source.videoWidth || source.width;
    const height = source.videoHeight || source.height;
    if (!width || !height) return null;
    const canvas = qualityCanvasRef.current || document.createElement('canvas');
    qualityCanvasRef.current = canvas;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  }, []);

  useEffect(() => {
    if (!enabled || !timerRunning) return undefined;
    if (simMode) {
      const tick = window.setInterval(() => {
        const epoch = shotEpochRef.current;
        if (!epoch) return;
        const tS = (Date.now() - epoch) / 1000;
        const bar = simulatedPressureBarAt(tS);
        if (bar == null) return;
        sessionRef.current.pushRaw(bar, true);
        const all = sessionRef.current.getSamples();
        setSamples([...all]);
        const held = holdRef.current.push({ bar, fresh: true, now: Date.now() });
        setHold({ held: held.held, gap: held.gap });
        setDisplayBar(rollingDisplayBar(all, tS));
        setPeakBar(peakBarFromRaw(all));
      }, 200);
      return () => window.clearInterval(tick);
    }
    if (!calibrated || !trackerRef.current) return undefined;

    let raf = 0;
    let last = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const wallNow = performance.now();
      if (wallNow - last < PROCESS_INTERVAL_MS) return;
      last = wallNow;
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        const image = grabSourceImage(video);
        if (!image) return;
        const read = readCalibratedFrame(image, trackerRef.current);
        const held = holdRef.current.push({
          bar: read.ok ? read.bar : null,
          fresh: read.ok === true,
          now: Date.now(),
        });
        const epoch = shotEpochRef.current;
        if (read.ok && read.bar != null && epoch) {
          sessionRef.current.pushRaw(read.bar, true);
        }
        const all = sessionRef.current.getSamples();
        const tS = epoch ? (Date.now() - epoch) / 1000 : timerSeconds;
        setSamples([...all]);
        setHold({ held: held.held, gap: held.gap });
        setDisplayBar(rollingDisplayBar(all, tS) ?? (held.gap ? null : held.bar));
        setPeakBar(peakBarFromRaw(all));
      } catch {
        setReaderError('Pressure reader paused');
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [
    enabled,
    timerRunning,
    calibrated,
    simMode,
    grabSourceImage,
    timerSeconds,
    videoRef,
  ]);

  const acceptCalibration = useCallback(
    ({ calibration, tracker }) => {
      trackerRef.current = tracker ?? createCalibratedTracker(calibration);
      setCalibrated(true);
      onCalibrationSaved?.(calibration);
    },
    [onCalibrationSaved],
  );

  const getShotMetrics = useCallback(() => sessionRef.current.getShotMetrics(), []);

  const showLive =
    enabled && timerRunning && (calibrated || simMode) && (simMode || status === 'live');

  return {
    videoRef,
    samples,
    displayBar,
    hold,
    peakBar,
    calibrated,
    showLive,
    readerError,
    acceptCalibration,
    getShotMetrics,
    cameraStatus: status,
  };
}
