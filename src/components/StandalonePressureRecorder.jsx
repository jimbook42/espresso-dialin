import { Gauge } from 'lucide-react';
import { PreShotDialStatus } from './PreShotDialStatus.jsx';
import { ShotLabPressureIntegration } from './ShotLabPressureIntegration.jsx';
import { ShotPressureChart } from './ShotPressureChart.jsx';
import { ScaleTimerControls } from './ScaleTimerControls.jsx';
import { useShotLabPressureContext } from './ShotLabPressureContext.jsx';

export function StandalonePressureRecorder({
  ui, state, cameraAvailable, simulatedPressure, onEnableCamera,
  onStart, onStop, onDiscard, onSave, onHistory, onSettings,
  elapsed, pressure, details, setDetails, saving, settling, error, scale,
}) {
  const camera = useShotLabPressureContext();
  const busy = state === 'recording' || state === 'starting';
  const ready = camera?.preShotDialStatus === 'found';
  const samples = pressure?.labPressureCurve;
  const button = 'min-h-11 px-4 rounded-xl text-sm font-bold disabled:opacity-50';
  const input = `${ui.input} border rounded-lg w-full min-w-0 min-h-11 px-3`;
  const update = (event) => {
    const { name, value } = event.target;
    setDetails((current) => ({
      ...current,
      [name]: value,
      ...(name === 'yield' ? { yieldSource: 'manual' } : {}),
    }));
  };
  return (
    <section aria-labelledby="pressure-title" className={`${ui.card} rounded-2xl p-4 space-y-4`}>
      <div className="flex items-center gap-3">
        <Gauge className={`w-6 h-6 ${ui.accentText}`} aria-hidden="true" />
        <h2 id="pressure-title" className={ui.pageTitle}>Pressure Tracker</h2>
      </div>
      {simulatedPressure && <p className={`text-sm ${ui.sub}`}>Simulated pressure preview</p>}
      {state === 'idle' && (
        <>
          {!cameraAvailable && <p className={`text-sm ${ui.sub}`}>Camera pressure is unavailable in this build.</p>}
          {cameraAvailable && !camera?.enabled && (
            <button type="button" className={`${button} ${ui.primary}`} onClick={onEnableCamera}>Enable camera</button>
          )}
          {cameraAvailable && camera?.enabled && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={`${button} ${ui.secondaryBtn}`} onClick={camera.openCalibrate}>
                {camera.storedCalibration ? 'Recalibrate gauge' : 'Calibrate gauge'}
              </button>
              {!simulatedPressure && (
                <button type="button" className={`${button} ${ui.secondaryBtn}`} onClick={camera.flipCamera}>
                  Use {camera.facingMode === 'environment' ? 'front' : 'rear'} camera
                </button>
              )}
              <PreShotDialStatus status={camera.preShotDialStatus} cameraError={camera.cameraError} retryCamera={camera.retryCamera} />
            </div>
          )}
        </>
      )}
      {state !== 'review' && scale && (
        <div className="[&_button]:min-h-11 [&_select]:min-h-11">
          <ScaleTimerControls
            ui={ui}
            {...scale}
            timerRunning
            onConnect={scale.connect}
            onDisconnect={scale.disconnect}
            onTare={state === 'idle' ? scale.tare : undefined}
            onTransportKindChange={scale.setTransportKind}
          />
        </div>
      )}
      {busy && (
        <div className="space-y-2">
          <p aria-label="Elapsed time" className={`font-mono text-4xl ${ui.text}`}>{elapsed}</p>
          <ShotLabPressureIntegration variant="inline" ui={ui} />
          {['error', 'interrupted'].includes(camera?.cameraStatus) && !simulatedPressure && (
            <PreShotDialStatus
              status={camera.cameraStatus === 'error' ? 'unavailable' : 'interrupted'}
              cameraError={camera.cameraError} retryCamera={camera.retryCamera}
            />
          )}
          {camera?.cameraStatus === 'live' && camera.hold?.gap && (
            <p role="status" className={`text-sm ${ui.sub}`}>
              {camera.readerError || 'Waiting for a valid pressure reading'}
            </p>
          )}
        </div>
      )}
      {state === 'idle' && (
        <button type="button" className={`${button} ${ui.primary} w-full`}
          disabled={!cameraAvailable || !camera?.enabled || (!ready && !simulatedPressure)} onClick={onStart}>
          Start recording
        </button>
      )}
      {state === 'starting' && <p role="status">Starting recording…</p>}
      {state === 'recording' && (
        <button type="button" className={`${button} ${ui.primary} w-full`} onClick={onStop}>Stop recording</button>
      )}
      {state === 'review' && (
        <form className="space-y-3" onSubmit={onSave}>
          <h3 className={ui.sectionTitle}>Review recording</h3>
          <p className={`text-sm ${ui.sub}`}>Duration {elapsed}</p>
          {samples?.length ? (
            <>
              <ShotPressureChart samples={samples} peakBar={pressure.labPressurePeakBar} />
              <label className={ui.label}>Shot name<input name="name" className={input} value={details.name} onChange={update} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className={ui.label}>Dose (g)<input name="dose" type="number" min="0.01" step="any" inputMode="decimal" className={input} value={details.dose} onChange={update} /></label>
                <label className={ui.label}>Yield (g)<input name="yield" type="number" min="0" step="any" inputMode="decimal" className={input} value={details.yield} onChange={update} /></label>
              </div>
              <label className={ui.label}>Rating<select name="rating" className={input} value={details.rating} onChange={update}>
                <option value="">Optional</option>
                {[1, 2, 3, 4, 5].map((rating) => <option key={rating} value={rating}>{rating}</option>)}
              </select></label>
              <label className={ui.label}>Notes<textarea name="notes" className={input} value={details.notes} onChange={update} /></label>
            </>
          ) : <p role="status">No valid pressure samples were captured.</p>}
          {error && <p role="alert">{error}</p>}
          {settling && <p role="status">Measuring final yield…</p>}
          <div className="flex flex-wrap gap-2">
            {samples?.length > 0 && (
              <button type="submit" className={`${button} ${ui.primary}`} disabled={saving || settling}>
                {saving ? 'Saving…' : 'Save recording'}
              </button>
            )}
            <button type="button" className={`${button} ${ui.secondaryBtn}`} disabled={saving || settling} onClick={onDiscard}>
              Discard recording
            </button>
          </div>
        </form>
      )}
      {state === 'idle' && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`${button} ${ui.secondaryBtn}`} onClick={onSettings}>Pressure settings</button>
          <button type="button" className={`${button} ${ui.secondaryBtn}`} onClick={onHistory}>View shot history</button>
        </div>
      )}
    </section>
  );
}
