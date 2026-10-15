// The space on each side of the page on wide screens (1600px and up), kept for advertising. Blank for now: the fixed
// 160 x 600 box (the standard "wide skyscraper") reserves the room, so adding an ad later moves nothing on the page.
//
// To fill a rail later:
//   - a sponsor ad we serve ourselves (an image and a link from our own server): put it inside the box, label it
//     "Advertisement", and nothing else changes (no cookies, no tracking, so the privacy policy already covers it);
//   - an ad network (Google AdSense and similar) also needs: its script and frame hosts added to the
//     Content-Security-Policy in src/server.ts (SECURITY_HEADERS), the partner named in the privacy policy
//     (src/legal/content.ts, privacy > Cookies and Advertising), a consent banner for EU and UK visitors, and a
//     "Your privacy choices" opt-out link that also honours Global Privacy Control.
// Ads are never aimed at players or based on information about them (terms > Advertising).
export function AdRail({ side }: { side: 'left' | 'right' }) {
  return (
    <div data-ad-slot={`rail-${side}`} aria-hidden className="hidden pt-5 rails:block">
      <div className="sticky top-[4.5rem] min-h-[600px] w-[160px]" />
    </div>
  );
}
