import { describe, it, expect } from 'vitest';
import { conferenceAudit, type MemberRow } from '../../src/jobs/statAudit.js';

const row = (season: number, program: string, conference: string | null, extra: Partial<MemberRow> = {}): MemberRow =>
  ({ season, program, gender: 'w', division: 'd1', conference, ncaa_member: true, ...extra });

describe('conferenceAudit', () => {
  const last = ['Illinois', 'Iowa', 'Michigan', 'Ohio St.', 'Penn St.'].map((p) => row(2025, p, 'Big Ten'));
  it('flags D1/D2 members with no conference and a conference that lost most of its teams', () => {
    const now = [row(2026, 'Illinois', null), row(2026, 'Iowa', null), row(2026, 'Michigan', 'Big Ten'), row(2026, 'Ohio St.', 'Big Ten'), row(2026, 'Penn St.', null),
      row(2026, 'Club side', null, { ncaa_member: false }), row(2026, 'D3 team', null, { division: 'd3' })];
    const [members, size] = conferenceAudit([...last, ...now], 2026);
    expect(members).toMatchObject({ check_key: 'conf:members', compared: 5, agree: 2 });
    expect(members!.worst.map((w: any) => w.who)).toEqual(['Women D1: Illinois', 'Women D1: Iowa', 'Women D1: Penn St.']);
    expect(size).toMatchObject({ check_key: 'conf:size', compared: 1, agree: 0, worst: [{ who: 'Women Big Ten', ours: 2, theirs: 5 }] });
  });
  it('passes when every member has its conference', () => {
    const now = last.map((r) => ({ ...r, season: 2026 }));
    const [members, size] = conferenceAudit([...last, ...now], 2026);
    expect(members!.rate).toBe(1); expect(size!.rate).toBe(1);
  });
});
