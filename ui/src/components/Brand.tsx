// The Plaibook Stats lockup, or just the Plaibook mark where space is tight. Both are light-on-dark with
// transparent backgrounds, so they sit correctly on navy. `size` is the rendered height in px.
export function Logo({ size = 28, withText = true, className = '' }: { size?: number; withText?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      {withText
        ? <img src="/brand/plaibook-stats-logo.png" alt="Plaibook Stats" width={Math.round(size * 779 / 144)} height={size} className="shrink-0" />
        : <img src="/brand/plaibook-mark.png" alt="Plaibook Stats" width={size} height={size} style={{ height: size, width: 'auto' }} className="shrink-0" />}
    </span>
  );
}
