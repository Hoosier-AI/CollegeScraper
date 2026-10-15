// Pure: an iCalendar (.ics) feed of a team's matches, for "Add to calendar" (Apple, Google, Outlook subscribe to the
// url and pick up changes). Times in UTC; a match without a kickoff time is an all-day event on its date.
export interface IcsEvent { uid: string; start: Date | null; date: string; minutes?: number; summary: string; location?: string | null; description?: string | null; url?: string | null }

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
/** Lines longer than 75 octets continue on the next line after a space (RFC 5545). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let n = 75;
    while (Buffer.byteLength(rest.slice(0, n), 'utf8') > 75) n--;
    out.push(rest.slice(0, n)); rest = ` ${rest.slice(n)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

export function icsCalendar(name: string, events: IcsEvent[], now = new Date()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Plaibook Stats//Fixtures//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${esc(name)}`, 'X-PUBLISHED-TTL:PT6H'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`);
    if (e.start) {
      lines.push(`DTSTART:${stamp(e.start)}`, `DTEND:${stamp(new Date(e.start.getTime() + (e.minutes ?? 120) * 60_000))}`);
    } else {
      const d = e.date.replace(/-/g, ''), next = new Date(Date.parse(`${e.date}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10).replace(/-/g, '');
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`);
    }
    lines.push(`SUMMARY:${esc(e.summary)}`);
    if (e.location) lines.push(`LOCATION:${esc(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
