import { PROCESS_INTERVAL_MS, wrapDelta } from './gaugeConfig.js';
import { publishTapBar } from './tapCalibrate.js';

export const TAP_DISPLAY_HOLD_MS = 450;
export const TAP_MODEL_MAX_AGE_MS = 2 * PROCESS_INTERVAL_MS;

/** An unregistered/canonical or stale model output cannot certify a tap pressure. */
export function currentTapModel(frame, shotT0) {
  const { read, nowMs, r5Pose: pose, r5CapturedAtMs: captured } = frame;
  if (!frame.r5Registered || !frame.r5Corroborated || frame.r5Bar == null
    || !Number.isFinite(frame.r5Bar) || !(frame.r5Conf >= 0.6)
    || !Number.isFinite(captured) || captured < shotT0 || captured > nowMs
    || nowMs - captured > TAP_MODEL_MAX_AGE_MS || read.lost || read.duplicate || read.frameMissing
    || !pose?.hub || !read.hub || pose.epoch !== read.poseEpoch) return null;
  const shift = Math.abs(wrapDelta(pose.shiftDeg ?? 0, read.shiftDeg ?? 0));
  const distance = Math.hypot(pose.hub.x - read.hub.x, pose.hub.y - read.hub.y);
  const ratio = pose.radius / read.radius;
  if (shift > 3 || distance > Math.max(3, read.radius * 0.08) || ratio < 0.9 || ratio > 1.1) return null;
  return { bar: frame.r5Bar, angle: frame.r5Angle, capturedAtMs: captured };
}

/** Fresh observations and short display holds are separate states. Never re-zero a shot. */
export function createTapReadingPublisher(config) {
  let last = null, pending = [], shotT0 = 0;
  const rejectionCounts = { publisher: 0, rate: 0, byReason: {} };
  const resetCounts = () => {
    rejectionCounts.publisher = 0;
    rejectionCounts.rate = 0;
    rejectionCounts.byReason = {};
  };
  const noteRejection = (reason) => {
    const underlying = String(reason ?? 'unspecified').replace(/^held:/, '');
    rejectionCounts.byReason[underlying] = (rejectionCounts.byReason[underlying] ?? 0) + 1;
    if (underlying === 'pose-lost' || underlying === 'needle-missing') return;
    rejectionCounts.publisher += 1;
    if (underlying.includes('rate')) rejectionCounts.rate += 1;
  };
  const reset = (epoch = 0) => { last = null; pending = []; shotT0 = epoch; resetCounts(); };
  const step = frame => {
    const { read, nowMs } = frame;
    const model = currentTapModel(frame, shotT0);
    const tapFresh = read.ok && !read.lost && read.fresh !== false && Number.isFinite(read.bar);
    let candidate = tapFresh ? { bar: read.bar, angle: read.needleDeg,
      capturedAtMs: frame.capturedAtMs ?? nowMs, source: 'tap' } : null;
    if (!candidate && model && (last == null || model.capturedAtMs > last.at)) {
      candidate = { ...model, source: 'model' };
    }
    let reason = read.lost ? 'pose-lost' : 'needle-missing';
    if (candidate && (candidate.capturedAtMs < shotT0 || candidate.capturedAtMs > nowMs)) {
      candidate = null; reason = 'stale-frame';
    }
    if (candidate) {
      const top = publishTapBar({ bar: candidate.bar, needleDeg: candidate.angle,
        tenDeg: read.tenDeg, previousBar: last?.bar });
      if (top == null || top !== candidate.bar) { candidate = null; reason = 'top-unconfirmed'; }
    }
    if (candidate && last != null) {
      const dt = Math.max(0, (candidate.capturedAtMs - last.at) / 1000);
      const limit = config.rateSlackBar + config.rateBarPerS * dt;
      if (Math.abs(candidate.bar - last.bar) > limit) {
        pending.push(candidate.bar);
        if (pending.length > config.relockCount) pending.shift();
        if (pending.length < config.relockCount || Math.max(...pending) - Math.min(...pending) > config.relockBandBar) {
          candidate = null; reason = 'rate-unconfirmed';
        }
      } else pending = [];
    }
    if (candidate) {
      pending = [];
      last = { bar: candidate.bar, at: candidate.capturedAtMs };
      return { bar: last.bar, fresh: true, held: false, uncertain: false,
        measuredAtMs: last.at, reason: candidate.source === 'tap' ? 'tap-fresh' : 'model-fresh' };
    }
    const held = !read.lost && last != null && nowMs - last.at <= TAP_DISPLAY_HOLD_MS;
    const outReason = held ? `held:${reason}` : reason;
    noteRejection(outReason);
    return { bar: held ? last.bar : null, fresh: false, held, uncertain: true,
      measuredAtMs: null, reason: outReason };
  };
  return { reset, beginShot: reset, step, rejectionCounts };
}
