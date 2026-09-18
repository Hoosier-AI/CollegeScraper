// The Plaibook mark plus the product name. The mark is the light-on-dark lockup cropped to the symbol,
// so it sits correctly on navy; `withText` is off wherever the name is already on screen.
export function Logo({ size = 28, withText = true, className = '' }: { size?: number; withText?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/brand/plaibook-mark.png" alt="Plaibook" width={size} height={size} style={{ height: size, width: 'auto' }} className="shrink-0" />
      {withText && (
        <span className="text-lg font-black tracking-tight text-ink-100">
          Plaibook <span className="text-teal-400">Stats</span>
        </span>
      )}
    </span>
  );
}
