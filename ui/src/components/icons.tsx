// Icons lucide does not have. Drawn on the same 24 px grid with a 1.75 stroke so they sit with lucide glyphs.

/** A soccer ball: the mark for a goal everywhere on the site. */
export function SoccerBall({ size = 16, className = '', title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="9.25" />
      <path d="M12 7.6l3.3 2.4-1.26 3.9H9.96L8.7 10z" fill="currentColor" />
      <path d="M12 7.6V2.8M15.3 10l4.5-1.5M14.04 13.9l2.8 3.85M9.96 13.9l-2.8 3.85M8.7 10L4.2 8.5" />
    </svg>
  );
}

/** One ball per goal, or a ball with a count past two. */
export function Goals({ n, size = 12, className = '' }: { n: number; size?: number; className?: string }) {
  if (!n) return null;
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} aria-label={`${n} goal${n === 1 ? '' : 's'}`} role="img">
      {n <= 2 ? Array.from({ length: n }, (_, i) => <SoccerBall key={i} size={size} />) : <><SoccerBall size={size} /><span className="text-2xs font-semibold tnum">{n}</span></>}
    </span>
  );
}
