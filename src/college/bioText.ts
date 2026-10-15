// The honors and bio lines copied from school athletics sites, as we publish them (privacy policy, /privacy#athletes).
// School bios end in personal sections (parents, siblings, major, birthplace) and start with high school and club
// careers; we keep the college achievements and drop the rest:
//   1. cut at a "Personal", "High school", "Prep", "Background" or "Before <school>" heading;
//   2. drop a line that still names family, a major, a birthplace or a high school;
//   3. drop what is left if it is only a heading ("Biography").
const CUT = /(?:^|[\s.;:–-])(?:PERSONAL(?: LIFE)?\b|Personal(?: Life)?(?=\s*:|\s+[A-Z])|HIGH SCHOOL\b|High School(?=\s*[:/])|PREP\b|Prep(?=\s*:)|BACKGROUND\b|Background(?=\s*:)|BEFORE [A-Z]|Before (?=[A-Z])|PRIOR TO [A-Z]|Prior to (?=[A-Z][a-z]+ [A-Z]))/;
const PRIVATE = /\b(?:son|daughter|child) of\b|\bsiblings?\b|\bparents?\b|\bbrothers?\b|\bsisters?\b|\bmother\b|\bfather\b|\bmom\b|\bdad\b|\bmajor(?:s|ed|ing)? in\b|\bmajoring\b|\bdegree in\b|\bborn (?:in|on)\b|\bhigh school\b|\bhs\b|\bfavou?rite\b|\bhobbies\b|\binstagram\b|\btwitter\b|\btiktok\b|\bsnapchat\b|(?:^|\s)@\w/i;
const HEADING_ONLY = /^(?:biography|bio|career|honors|awards|college|[-–:;.,\s])*$/i;

/** The publishable part of one honors line, or null when nothing publishable is left. */
export function publicHonor(text: string | null | undefined): string | null {
  if (!text) return null;
  let t = String(text);
  const cut = CUT.exec(t);
  if (cut) {
    t = t.slice(0, cut.index);
    // "Mountain View High School: MVP": the school's name sits before the heading.
    if (/high school/i.test(cut[0])) t = t.replace(/(?:\s+[A-Z][\w.'&-]*)+\s*$/, '');
  }
  t = t.replace(/[\s:;,–-]+$/, '').trim();
  if (!t || PRIVATE.test(t) || HEADING_ONLY.test(t) || t.replace(/^biography\s*/i, '').length < 12) return null;
  return t;
}
