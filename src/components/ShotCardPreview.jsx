import { isAndroidApp, saveAndroidFile } from '../native/androidShell.js';
import { useEffect, useRef, useState } from 'react';
import { drawShotCard, encodeShotCardPng } from '../utils/shotCard.js';

export function ShotCardPreview({ shot, bean, grind, referenceShot, filename, ui, onError, options, setOptions }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const canvas = useRef(null);
  useEffect(() => {
    let disposed = false;
    let url;
    try {
      drawShotCard(canvas.current, { shot, bean, grind, referenceShot: options.reference ? referenceShot : null, options });
      void encodeShotCardPng(canvas.current).then((blob) => {
        if (disposed) return;
        const file = new File([blob], filename + '.png', { type: 'image/png' });
        url = URL.createObjectURL(file);
        setPreview({ file, url, options, shot, bean, grind, referenceShot, filename });
      }).catch((error) => { if (!disposed) onError(error.message); });
    } catch (error) {
      onError(error.message);
    }
    return () => {
      disposed = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shot, bean, grind, referenceShot, options, filename, onError]);
  const ready = preview?.options === options && preview.shot === shot && preview.bean === bean
    && preview.grind === grind && preview.referenceShot === referenceShot && preview.filename === filename;
  const canShare = ready && (isAndroidApp || (navigator.share && navigator.canShare?.({ files: [preview.file] })));
  const deliverAndroid = async (share) => {
    setBusy(true);
    setStatus('');
    try {
      const result = await saveAndroidFile(preview.file, preview.file.name, share);
      setStatus(result.cancelled ? 'Save cancelled.' : share
        ? 'Share sheet opened. Check the receiving app for the PNG.'
        : `Saved and verified ${result.bytesWritten.toLocaleString()} bytes.`);
    } catch (error) {
      onError(error.message);
    } finally {
      setBusy(false);
    }
  };
  const download = () => {
    if (isAndroidApp) {
      void deliverAndroid(false);
      return;
    }
    const link = document.createElement('a');
    link.href = preview.url;
    link.download = preview.file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const share = async () => {
    try {
      if (isAndroidApp) {
        await deliverAndroid(true);
        return;
      }
      await navigator.share({ files: [preview.file], title: 'Espresso shot' });
    } catch (error) {
      if (error.name !== 'AbortError') download();
    }
  };
  const choices = [['brand', 'Show branding'], ['bean', 'Show bean name'], ['grinder', 'Show grinder'],
    ['date', 'Show date'], ['notes', 'Show personal notes'], ...(referenceShot ? [['reference', 'Include bean reference']] : [])];
  return <section className="space-y-3" aria-label="Shot card">
    <p className="font-semibold">PNG card</p>
    <p className={ui.sub}>Choose what to include. These privacy settings apply to the PNG only; JSON and CSV may contain personal details.</p>
    <div className="grid grid-cols-2 gap-2">{choices.map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2">
      <input className="size-5 accent-[#c88a4b] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c88a4b]" type="checkbox" checked={options[key]} onChange={(event) => setOptions({ ...options, [key]: event.target.checked })} />{label}
    </label>)}</div>
    <canvas ref={canvas} hidden />
    {ready && <img src={preview.url} alt="Preview of shot card" className="block w-full rounded-lg" />}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`min-h-11 rounded-lg px-3 py-2 font-semibold ${ui.secondaryBtn}`} disabled={!ready || busy} onClick={download}>Download PNG</button>
      {canShare && <button type="button" className={`min-h-11 rounded-lg px-3 py-2 font-semibold ${ui.secondaryBtn}`} disabled={busy} onClick={share}>Share PNG</button>}
    </div>
    {status && <p role="status">{status}</p>}
  </section>;
}
