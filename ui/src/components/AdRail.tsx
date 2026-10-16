// The space on each side of the page on wide screens (1600px and up), kept for advertising. The fixed 160 x 600 box
// (the standard "wide skyscraper") reserves the room, so an ad moves nothing on the page. It holds an AdSense unit
// while ads are switched on (components/AdSlot.tsx); otherwise it stays blank. The unit is added only on screens wide
// enough to show the rail, because Google cannot fill a hidden one.
// Ads are never aimed at players or based on information about them (terms > Advertising).
import { useEffect, useState } from 'react';
import { AdSlot } from './AdSlot';

const WIDE = '(min-width: 1600px)';

export function AdRail({ side }: { side: 'left' | 'right' }) {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(WIDE).matches);
  useEffect(() => {
    const m = window.matchMedia(WIDE);
    const fn = () => setWide(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return (
    <div data-ad-slot={`rail-${side}`} className="hidden pt-5 rails:block">
      <div className="sticky top-[4.5rem] min-h-[600px] w-[160px]">{wide && <AdSlot slot="rail" format="vertical" />}</div>
    </div>
  );
}
