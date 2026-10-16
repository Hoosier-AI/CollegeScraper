// One display ad unit (Google AdSense), shown only while ads are switched on and the slot has an id (hub > Bots >
// Deals > Site money). Labelled "Advertisement". See lib/money.ts for consent and personalisation.
import { useEffect, useRef } from 'react';
import { fillAd, loadAdsense, useMoney } from '../lib/money';

export function AdSlot({ slot, className = '', format = 'auto' }: { slot: 'rail' | 'inline'; className?: string; format?: 'auto' | 'vertical' | 'horizontal' }) {
  const { ads } = useMoney();
  const id = ads.slots[slot];
  const ref = useRef<HTMLModElement>(null);
  const on = ads.enabled && !!ads.client && !!id;
  useEffect(() => {
    if (!on) return;
    loadAdsense(ads.client!);
    fillAd(ref.current);
  }, [on, ads.client]);
  if (!on) return null;
  return (
    <div className={className}>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-chalk-500">Advertisement</p>
      <ins ref={ref} className="adsbygoogle block" style={{ display: 'block' }} data-ad-client={ads.client!} data-ad-slot={id!} data-ad-format={format} data-full-width-responsive={format === 'auto' ? 'true' : undefined} />
    </div>
  );
}
