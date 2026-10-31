import { TEMPORAL_GATE } from './temporalGate.js';
import r7ConfigJson from '../../scripts/needle-reader/r7_config.json' with { type: 'json' };

/** Browser-safe mirror of scripts/needle-reader/score_r7.mjs loadR7Config / gateConfigR7. */
export function loadR7Config() {
  const raw = r7ConfigJson;
  const {
    classicalDirect,
    classicalDirectMaxDisagreeBar,
    classicalDirectMaxR2Conf,
    plateauBiasCorrection,
    ...reader
  } = raw;
  return {
    reader,
    gate: { classicalDirect, classicalDirectMaxDisagreeBar, classicalDirectMaxR2Conf },
    plateauBiasCorrection,
  };
}

export function gateConfigR7(r7 = loadR7Config()) {
  return {
    ...TEMPORAL_GATE,
    recovery: 'wide',
    prelock: true,
    classicalCarryS: 0,
    holdGapS: 0.5,
    holdBandBar: 0.5,
    classicalDirect: r7.gate.classicalDirect === true,
    classicalDirectMaxDisagreeBar: r7.gate.classicalDirectMaxDisagreeBar ?? 2,
    classicalDirectMaxR2Conf: r7.gate.classicalDirectMaxR2Conf ?? null,
    classicalDirectAllowWeakR2: false,
    modelTiebreak: true,
  };
}
