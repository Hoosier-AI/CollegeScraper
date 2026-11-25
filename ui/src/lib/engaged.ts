// When a visit counts (track.ts). Pure, so the rule is tested (tests/ui/engaged.test.ts).
//
// The first rule was "any trusted input after three seconds in view". A crawler working through the site in real
// desktop browsers passes that with one pointer move: 2026-11-14 to 22 it was up to 1,690 "visitors" a day, 95%
// desktop, no referrer, one page each, 3,316 player views over 3,168 different player pages. A person either looks at
// a second page or stays: so a visit counts once there has been real input and
//   - a second page, three seconds in; or
//   - fifteen seconds in view with input at two moments at least five seconds apart (reading, not one synthetic move).
// A one-page visit shorter than that is not counted, a real one included: the totals read lower, and mean people.
export interface Engagement { input: boolean; shownMs: number; firstInputMs: number | null; lastInputMs: number | null; pages: number }

export const SECOND_PAGE_MS = 3000;
export const STAY_MS = 15000;
export const INPUT_SPREAD_MS = 5000;

export function isEngaged(e: Engagement): boolean {
  if (!e.input || e.firstInputMs == null || e.lastInputMs == null) return false;
  if (e.pages >= 2 && e.shownMs >= SECOND_PAGE_MS) return true;
  return e.shownMs >= STAY_MS && e.lastInputMs - e.firstInputMs >= INPUT_SPREAD_MS;
}
