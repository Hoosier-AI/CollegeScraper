// Where a college game is shown: the network a school's schedule (or NCAA.com) lists, in one spelling. Schools write
// the same network many ways ("ACCNX", "ACC Network Extra", "ACCN+"); the page shows one name and links to the
// school's own watch link when it gives one.

const ALIASES: [RegExp, string][] = [
  [/^ACC\s*(?:N(?:etwork)?\s*)?(?:X|Extra|Xtra|\+)$|^ACC\s*Network\s*(?:Extra|Xtra)$|^ACCNX$|^ACCN\+$/i, 'ACC Network Extra'],
  [/^ACC\s*N(?:etwork)?$|^ACCN$/i, 'ACC Network'],
  [/^ESPN\s*(?:\+|Plus)$/i, 'ESPN+'],
  [/^ESPN\s*U$/i, 'ESPNU'],
  [/^ESPN\s*2$/i, 'ESPN2'],
  [/^ESPN\s*News$/i, 'ESPNews'],
  [/^ESPN$/i, 'ESPN'],
  [/^SEC\s*N(?:etwork)?\s*(?:\+|Plus)$|^SECN\+$/i, 'SEC Network+'],
  [/^SEC\s*N(?:etwork)?$|^SECN$/i, 'SEC Network'],
  [/^(?:B1G|Big\s*Ten)\s*(?:\+|Plus)$/i, 'B1G+'],
  [/^(?:BTN|Big\s*Ten\s*Network)$/i, 'Big Ten Network'],
  [/^BTN\s*(?:\+|Plus)$/i, 'B1G+'],
  [/^(?:Big\s*12\s*Now|Big\s*12\s*Now\s*on\s*ESPN\+)$/i, 'Big 12 Now on ESPN+'],
  [/^Big\s*East\s*Digital\s*Network$/i, 'Big East Digital Network'],
  [/^(?:CBSSN|CBS\s*Sports\s*Network)$/i, 'CBS Sports Network'],
  [/^Paramount\s*\+$/i, 'Paramount+'],
  [/^Peacock$/i, 'Peacock'],
  [/^FS\s*1$/i, 'FS1'], [/^FS\s*2$/i, 'FS2'], [/^FOX$/i, 'FOX'],
  [/^Flo\s*(?:Sports|College|Soccer)?$/i, 'FloSports'],
  [/^(?:Mountain\s*West\s*Network|MW\s*Network)$/i, 'Mountain West Network'],
  [/^NEC\s*Front\s*Row$/i, 'NEC Front Row'],
  [/^(?:Pac-?\s?12\s*(?:Network|Insider|Now)?)$/i, 'Pac-12 Network'],
  [/^Pac-?\s?12\s*YouTube$/i, 'Pac-12 YouTube'],
  [/^(?:MW\s*\+|Mountain\s*West\s*(?:Plus|\+))$/i, 'MW+'],
  [/^(?:SoCon\s*Digital\s*Network|SDN)$/i, 'SoCon Digital Network'],
  [/^(?:SWAC\s*TV)$/i, 'SWAC TV'],
  [/^(?:Summit\s*League\s*Network)$/i, 'Summit League Network'],
  [/^(?:WCC\s*Network)$/i, 'WCC Network'],
  [/^(?:Horizon\s*League\s*Network)$/i, 'Horizon League Network'],
  [/^(?:YurView|Spectrum\s*(?:Sports)?\s*Net(?:work)?)$/i, 'Spectrum Sports'],
  [/^(?:NCAA\.com|NCAA\s*Live)$/i, 'NCAA.com'],
];

/** Words that are links or labels, not a network ("Watch", "Live Stats", "Tickets"). */
const NOT_A_NETWORK = /^(?:watch|watch live|live|live stats?|stats|video|tickets?|radio|audio|listen|tv|streaming|stream|tba|tbd|to be announced|to be determined|n\/a|none|no broadcast|no stream|not televised|no tv|-+)$/i;
/** Promotions schools put in the same cell ("Senior Night", "Alumni Day / 5v5"), not where the game is shown. */
const PROMOTION = /\b(?:senior|alumni|homecoming|family|military|pink|youth|kids?|fan|faculty|staff|hall of fame|appreciation|white ?out|blackout)\b.*\b(?:day|night|game|match)\b|\b5v5\b/i;

/** A network as a school or NCAA.com wrote it, in one spelling; null when it is a link label or empty. */
export function normalizeNetwork(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  s = s.replace(/^(?:TV|Watch|Stream|Streaming)\s*[:\-|]\s*/i, '').replace(/\s*\((?:tape|delay|delayed|live|\$)\)/gi, '').replace(/[_*]+$/, '').trim();
  if (!s || NOT_A_NETWORK.test(s) || PROMOTION.test(s) || /^https?:/i.test(s) || s.length > 48) return null;
  // Two networks at once ("ESPN+ / ACCNX"): each normalised, joined.
  const parts = s.split(/\s*(?:\/|&|;|,|\||\band\b)\s*/i).filter(Boolean);
  if (parts.length > 1 && parts.length <= 3) {
    const each = parts.map((p) => normalizeNetwork(p)).filter((p): p is string => !!p);
    return each.length ? [...new Set(each)].join(' / ') : null;
  }
  for (const [re, name] of ALIASES) if (re.test(s)) return name;
  return s;
}

/** True only for text that is a known network: for free text (schedule descriptors, notes), where a guess would
 *  turn a conference name or a sponsor line into a channel. */
export function isKnownNetwork(raw: string | null | undefined): boolean {
  const s = String(raw ?? '').replace(/\s+/g, ' ').replace(/^(?:TV|Watch)\s*[:\-|]\s*/i, '').trim();
  return !!s && ALIASES.some(([re]) => re.test(s));
}

/** The known network named somewhere in a line of free text ("CCSU vs. UAlbany, ESPN+, Final, 0-1"). */
export function networkInText(text: string | null | undefined): string | null {
  for (const part of String(text ?? '').split(/\s*[,|•·]\s*|\s+-\s+/)) if (isKnownNetwork(part)) return normalizeNetwork(part);
  return null;
}

/** The school's own watch link, when it is a real http(s) url. */
export function watchUrl(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : null;
}
