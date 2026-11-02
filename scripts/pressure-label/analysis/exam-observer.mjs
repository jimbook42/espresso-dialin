// Observational wrappers only: original calls, arguments and returned readings are preserved.
// Node 24 registerHooks avoids editing any reader or exam file.
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
const state = globalThis.__labelAnalysis = { series: [], diagnostics: new WeakMap() };
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.endsWith('/tapCalibrate.js')) {
      let source = String(result.source);
      source = source.replace('export function readCalibratedFrame(', 'function observedOriginalRead(');
      source += `
export function readCalibratedFrame(image, tracker, diagnostics = null) {
  const diag = diagnostics || {};
  const read = observedOriginalRead(image, tracker, diag);
  globalThis.__labelAnalysis.diagnostics.set(read, diag);
  return read;
}
`;
      return { ...result, source };
    }
    if (url.endsWith('/shotLabR7Live.js')) {
      let source = String(result.source);
      source = source.replace('export function createShotLabR7Publisher(', 'function observedOriginalPublisher(');
      source += `
export function createShotLabR7Publisher(calibration, options = {}) {
  const publisher = observedOriginalPublisher(calibration, options);
  const {template, needleTemplate, ...smallCalibration} = calibration;
  const series = { calibration: smallCalibration, frames: [] };
  globalThis.__labelAnalysis.series.push(series);
  const original = publisher.stepFrame;
  publisher.stepFrame = frame => {
    const out = original(frame);
    series.frames.push({timeS: frame.nowMs / 1000, read: frame.read,
      pointer: globalThis.__labelAnalysis.diagnostics.get(frame.read)?.pointer ?? null,
      output: {bar:out.bar,fresh:out.fresh,held:out.held,reason:out.reason,measuredAtMs:out.measuredAtMs}});
    return out;
  };
  return publisher;
}
`;
      return { ...result, source };
    }
    return result;
  },
});
process.on('exit', () => writeFileSync(new URL('../../needle-reader/out/exam-observed.json', import.meta.url), JSON.stringify(state.series)));
