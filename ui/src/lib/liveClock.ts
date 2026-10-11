// The college live clock in plain words. NCAA's feed gives a period ("1ST HALF", "2ND HALF", "HALFTIME", "1ST OT")
// and a clock that counts up through the whole match ("85:02" late in the 2nd half). Shown as the minute being played,
// the way soccer reads it ("86′"), and how much of the 90 minutes is left ("5 min left"), never period codes like "2H".

export interface LiveClock {
  /** The minute being played ("86′", "45′+"), or a word ("Half time"). */
  minute: string;
  /** "5 min left", "52 min left", "Added time", "" when unknown. */
  detail: string;
  /** "2nd half", "Half time", "Overtime"... */
  period: string;
  /** One sentence for a header or a screen reader: "86th minute of the 2nd half, 5 minutes left". */
  long: string;
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const mins = (n: number) => `${n} ${n === 1 ? 'minute' : 'minutes'}`;

export function liveClock(live: { period: string | null; clock: string | null } | null | undefined): LiveClock {
  const unknown: LiveClock = { minute: 'Live', detail: '', period: '', long: 'In play' };
  if (!live) return unknown;
  const p = (live.period ?? '').toUpperCase().trim();
  if (/HALF ?TIME|^HALF$|^HT$/.test(p)) return { minute: 'Half time', detail: '45 min left', period: 'Half time', long: 'Half time, 45 minutes left' };
  if (/^FINAL|FULL ?TIME/.test(p)) return { minute: 'Full time', detail: 'Result to follow', period: 'Full time', long: 'Full time, result to follow' };
  if (/END|BREAK/.test(p)) return { minute: 'Break', detail: '', period: 'Break', long: 'Break in play' };
  const c = live.clock?.match(/^(\d+):(\d\d)$/);
  const ot = p.match(/(\d)?\s*(?:ST|ND|RD|TH)?\s*OT|OVERTIME/);
  const half = /1ST/.test(p) && !ot ? 1 : /2ND/.test(p) && !ot ? 2 : null;
  if (!c) { const period = half ? `${ordinal(half)} half` : ot ? 'Overtime' : ''; return period ? { minute: period, detail: '', period, long: period } : unknown; }
  let sec = Number(c[1]) * 60 + Number(c[2]);
  if (ot) {
    // Two 10-minute periods after 90; a feed that restarts the clock each period is moved on to match.
    const n = Number(ot[1] ?? (/2ND/.test(p) ? 2 : 1));
    const start = 90 * 60 + (n - 1) * 600, end = start + 600;
    if (sec < start) sec += start;
    const minute = Math.max(start / 60 + 1, Math.ceil(sec / 60));
    if (sec >= end) return { minute: `${end / 60}′+`, detail: 'Added time', period: `Overtime ${n}`, long: `Added time, overtime period ${n}` };
    const left = Math.ceil((end - sec) / 60);
    return { minute: `${minute}′`, detail: `OT, ${left} min left`, period: `Overtime ${n}`, long: `${ordinal(minute)} minute, overtime period ${n}, ${mins(left)} left in it` };
  }
  const endOfHalf = half === 1 ? 45 * 60 : 90 * 60;
  const period = half ? `${ordinal(half)} half` : '';
  if (half && sec >= endOfHalf) return { minute: `${endOfHalf / 60}′+`, detail: 'Added time', period, long: `Added time at the end of the ${period}` };
  const minute = Math.max(1, Math.ceil(sec / 60));
  const leftSec = 90 * 60 - sec;
  const detail = leftSec <= 0 ? '' : leftSec < 60 ? '<1 min left' : `${Math.ceil(leftSec / 60)} min left`;
  return { minute: `${minute}′`, detail, period, long: `${ordinal(minute)} minute${period ? ` of the ${period}` : ''}${leftSec > 0 ? `, ${leftSec < 60 ? 'under a minute' : mins(Math.ceil(leftSec / 60))} left` : ''}` };
}
