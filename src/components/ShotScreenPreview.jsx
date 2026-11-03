import { useEffect, useRef, useState } from 'react';
import { ShotScreenView } from './AdaptiveShotScreen.jsx';

/** Lay out a whole phone first, then scale the phone, including its controls. */
export function ShotScreenPreview({ settings }) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    const fit = ({ width, height }) => {
      if (width > 0 && height > 0) setScale(Math.min(width / 390, height / 844));
    };
    fit(container.getBoundingClientRect());
    const observer = new ResizeObserver(([entry]) => fit(entry.contentRect));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return <div ref={containerRef} data-testid="shot-screen-preview"
    className="relative w-full" style={{ aspectRatio: '390 / 844' }}>
    <div data-testid="shot-screen-preview-phone"
      className="absolute left-0 top-0 flex flex-col bg-[#121110] text-[#f5f2eb] rounded-xl"
      style={{ width: 390, height: 844, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
      <div className="h-14 shrink-0 border-b border-[#2e2b26] px-4 flex items-center text-xs text-[#a09880]">Extracting · example</div>
      <div className="flex flex-col flex-1 min-h-0 px-4 py-3">
        <ShotScreenView key={JSON.stringify(settings?.shotScreen)} settings={settings} preview
          values={{ pressure: 8.4, weight: 24.6, time: 21.3, flow: 1.8 }} targetYieldG={36} targetTimeS={30} />
      </div>
      <div className="shrink-0 p-4 space-y-3">
        <div className="h-1 rounded-full bg-[#2e2b26]" />
        <p className="text-center text-[11px] text-[#6b6457]">Stop shot to fill shot time</p>
        <button type="button" disabled className="w-full h-14 rounded-xl bg-[#c88a4b] text-[#121110] font-bold">Stop shot</button>
        <button type="button" disabled className="w-full h-12 rounded-xl border border-[#2e2b26] text-[#6b6457]">Cancel</button>
      </div>
    </div>
  </div>;
}
