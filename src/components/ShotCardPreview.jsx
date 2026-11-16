import { useEffect, useRef, useState } from 'react';
import { drawShotCard } from '../utils/shotCard.js';

export function ShotCardPreview({ shot, bean, grind, referenceShot, filename, ui, onError }) {
  const [options, setOptions] = useState({ brand: true, bean: false, grinder: false, date: false, notes: false, reference: false });
  const [preview, setPreview] = useState('');
  const canvas = useRef(null);
  useEffect(() => {
    try {
      drawShotCard(canvas.current, { shot, bean, grind, referenceShot: options.reference ? referenceShot : null, options });
      setPreview(canvas.current.toDataURL('image/png'));
    } catch (error) { onError(error.message); }
  }, [shot, bean, grind, referenceShot, options, onError]);
  const save = async (share) => {
    try {
      const blob = await new Promise((resolve) => canvas.current.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not create the PNG.');
      const file = new File([blob], filename + '.png', { type: 'image/png' });
      if (share && navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ files: [file], title: 'Espresso shot' });
      } else {
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = file.name; document.body.appendChild(link); link.click(); link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) { if (error.name !== 'AbortError') onError(error.message); }
  };
  const choices = [['brand', 'Show branding'], ['bean', 'Show bean name'], ['grinder', 'Show grinder'],
    ['date', 'Show date'], ['notes', 'Show personal notes'], ...(referenceShot ? [['reference', 'Include bean reference']] : [])];
  return <section className="space-y-3" aria-label="Shot card">
    <p className="font-semibold">PNG card</p>
    <p className={ui.sub}>Choose what to include. These privacy settings apply to the PNG only; JSON and CSV may contain personal details.</p>
    <div className="grid grid-cols-2 gap-2">{choices.map(([key, label]) => <label key={key} className="flex min-h-11 items-center gap-2">
      <input type="checkbox" checked={options[key]} onChange={(event) => setOptions({ ...options, [key]: event.target.checked })} />{label}
    </label>)}</div>
    <canvas ref={canvas} hidden />
    {preview && <img src={preview} alt="Preview of shot card" className="block w-full rounded-lg" />}
    <div className="flex flex-wrap gap-2">
      <button type="button" className={`min-h-11 rounded-lg px-3 py-2 font-semibold ${ui.secondaryBtn}`} onClick={() => save(false)}>Download PNG</button>
      {typeof navigator !== 'undefined' && navigator.share && <button type="button" className={`min-h-11 rounded-lg px-3 py-2 font-semibold ${ui.secondaryBtn}`} onClick={() => save(true)}>Share PNG</button>}
    </div>
  </section>;
}
