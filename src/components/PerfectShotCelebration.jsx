import { useEffect, useState } from 'react';
import {
  PERFECT_SHOT_CELEBRATION_MS,
  PERFECT_SHOT_CELEBRATION_REDUCED_MS,
} from '../utils/perfectShot.js';

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const CAMEO_1X = '/egg/toast-suit.png';
const CAMEO_1X_GOLD = '/egg/toast-gold.png';
const CAMEO_2X = '/egg/toast-suit@2x.png';
const CAMEO_2X_GOLD = '/egg/toast-gold@2x.png';

const CAMEO_WIDTH = 108;
const CAMEO_HEIGHT = Math.round((269 / 240) * CAMEO_WIDTH);

/**
 * Non-blocking overlay: soft yield ring (via parent class) + lower-right cameo.
 * @param {{ variant: 'suit' | 'gold', onComplete: () => void }} props
 */
export function PerfectShotCelebration({ variant, onComplete }) {
  const [motionClass, setMotionClass] = useState('perfect-shot-cameo--enter');

  useEffect(() => {
    const reduced = prefersReducedMotion();
    const totalMs = reduced ? PERFECT_SHOT_CELEBRATION_REDUCED_MS : PERFECT_SHOT_CELEBRATION_MS;
    const fadeOutLeadMs = reduced ? 0 : 400;

    let exitTimer;
    const doneTimer = window.setTimeout(() => {
      onComplete();
    }, totalMs);

    if (!reduced) {
      const enterHoldMs = totalMs - fadeOutLeadMs;
      exitTimer = window.setTimeout(() => {
        setMotionClass('perfect-shot-cameo--exit');
      }, enterHoldMs);
    }

    return () => {
      window.clearTimeout(doneTimer);
      if (exitTimer) window.clearTimeout(exitTimer);
    };
  }, [onComplete]);

  const isGold = variant === 'gold';
  const src1x = isGold ? CAMEO_1X_GOLD : CAMEO_1X;
  const src2x = isGold ? CAMEO_2X_GOLD : CAMEO_2X;
  const reduced = prefersReducedMotion();

  return (
    <img
      data-testid="perfect-shot-cameo"
      className={`perfect-shot-cameo perfect-shot-cameo--anchored ${reduced ? 'perfect-shot-cameo--static' : motionClass}`}
      src={src1x}
      srcSet={`${src1x} 1x, ${src2x} 2x`}
      width={CAMEO_WIDTH}
      height={CAMEO_HEIGHT}
      alt=""
      decoding="async"
      aria-hidden="true"
      style={{ pointerEvents: 'none' }}
    />
  );
}
