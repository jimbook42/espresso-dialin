import { useEffect, useRef, useState } from 'react';
import { feedbackMailto, prepareGaugeFeedback, prepareShotFeedback, shareFeedbackFiles } from '../feedbackShare.js';
import { downloadBlobFile } from '../flairPressureLab/labShotReplayExport.js';

export function FeedbackShareDialog({ shot, gaugeReason, ui, onClose, onShotShare }) {
  const dialog = useRef(null);
  const [note, setNote] = useState('');
  const [clip, setClip] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fallback, setFallback] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, []);

  const share = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const feedback = note.trim();
      const payload = shot ? prepareShotFeedback(shot, feedback) : prepareGaugeFeedback(gaugeReason, feedback, clip);
      const result = await shareFeedbackFiles(window.navigator, payload);
      if (result === 'cancelled') return;
      if (result === 'share') {
        if (shot) onShotShare?.('share');
        onClose();
        return;
      }
      downloadBlobFile(payload.files[0].name, payload.files[0]);
      setFallback({ href: feedbackMailto(payload.title, feedback), clip: Boolean(clip) });
    } catch {
      setError('Could not prepare the diagnostic file. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby="feedback-share-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      className={`m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-[#3a3836] p-4 backdrop:bg-black/70 ${ui.card} ${ui.text}`}>
      <form onSubmit={share} className="space-y-3">
        <h2 id="feedback-share-title" className="text-base font-bold">{shot ? 'Share shot' : 'Send us a clip'}</h2>
        <p className="text-sm">{shot
          ? 'The selected diagnostic JSON may contain shot measurements and associated notes.'
          : 'The diagnostic JSON includes the app version and a gauge compatibility summary. You can also choose a video from your device.'}</p>
        {fallback ? (
          <>
            <p role="status" className="text-sm">Attach the downloaded diagnostic JSON file before sending.
              {fallback.clip && ' Attach your selected video manually as well.'}</p>
            <a className={`inline-flex min-h-11 items-center font-bold ${ui.accentText}`}
              href={fallback.href} onClick={() => { if (shot) onShotShare?.('mailto'); }}>Open email</a>
          </>
        ) : (
          <>
            <label className="block text-sm">
              What went wrong? (optional)
              <textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)}
                className="mt-1 block w-full rounded-lg border border-current bg-transparent p-2" rows={2} />
            </label>
            {!shot && (
              <label className="block text-sm">
                Video from your device (optional)
                <input type="file" accept="video/*" onChange={(event) => setClip(event.target.files?.[0] ?? null)}
                  className="mt-1 block max-w-full" />
              </label>
            )}
          </>
        )}
        {error && <p role="alert" className="text-sm">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} onClick={onClose} className="min-h-11 px-2">
            {fallback ? 'Done' : 'Cancel'}
          </button>
          {!fallback && (
            <button type="submit" disabled={busy}
              className="min-h-11 rounded-xl bg-[#c88a4b] px-4 font-bold text-[#121110]">
              Share
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
