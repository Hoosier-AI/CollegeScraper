// The one loud element on the Team page: who they are, their record, their form, and how the record checks out.
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';
import { fmt, resultOf, useAdmin } from '../../lib/api';
import { genderLabel, divisionLabel, useHref } from '../../lib/filters';
import { Badge, Figure, FormPips, ResultBadge, TeamLogo, VerifiedMark, type VerifyState } from '../../components/primitives';

export function sideOf(g: any, id: string) {
  const home = g.home_program_id === id;
  const us = home ? g.home_score : g.away_score, them = home ? g.away_score : g.home_score;
  return { home, us, them, result: g.status === 'final' ? resultOf(us, them) : null, opp: home ? g.away_name : g.home_name, oppId: home ? g.away_program_id : g.home_program_id, oppLogo: home ? g.away_logo : g.home_logo, where: g.neutral_site ? 'vs' : home ? 'vs' : 'at' };
}

export function TeamMasthead({ t, id, season, games }: { t: any; id: string; season: number; games: any[] | undefined }) {
  const admin = useAdmin();
  const href = useHref();
  const p = t.program, s = t.teamStats, school = p.college_schools;
  const conf = t.season?.college_conferences?.name;
  const finals = (games ?? []).filter((g) => g.status === 'final').sort((a, b) => String(a.game_date).localeCompare(String(b.game_date)));
  const last = finals[finals.length - 1];
  const next = (games ?? []).filter((g) => g.status !== 'final').sort((a, b) => String(a.game_date).localeCompare(String(b.game_date)))[0];
  const ncaaRec = t.season?.official_w != null ? fmt.rec(t.season.official_w, t.season.official_l, t.season.official_t) : null;
  const ours = s ? fmt.rec(s.w, s.l, s.t) : null;
  // Two independent checks: the conference table (conf + overall record) and NCAA.com's leaderboard record.
  const checks: any[] = t.standingsChecks ?? [];
  const stateOf = (fields: string[], fallback: VerifyState): { state: VerifyState; details?: { field: string; official: string; ours: string }[] } => {
    const bad = checks.filter((c) => fields.includes(c.field));
    const lag = checks.filter((c) => fields.some((f) => c.field === `${f}_lag`));
    const dup = checks.filter((c) => fields.some((f) => c.field === `${f}_ncaa_duplicate`));
    const det = (xs: any[]) => xs.map((c) => ({ field: String(c.field).replace(/_lag|_ncaa_duplicate/, '').replace(/_/g, ' '), official: c.official, ours: c.computed }));
    if (bad.length) return { state: 'mismatch', details: det(bad) };
    if (lag.length) return { state: 'lag', details: det(lag) };
    if (dup.length) return { state: 'lag', details: det(dup) };
    return { state: fallback };
  };
  const confCheck = stateOf(['conf_record', 'overall_record'], t.standing?.source === 'conference' ? 'ok' : 'none');
  const os = t.season, ts = s;
  const behind = !!(os && ts && os.official_w <= ts.w && os.official_l <= ts.l && os.official_t <= ts.t);
  const ncaaCheck = stateOf(['ncaa_record'], ncaaRec ? (ncaaRec === ours ? 'ok' : behind ? 'lag' : 'mismatch') : 'none');
  if (ncaaCheck.state === 'mismatch' && !ncaaCheck.details && ncaaRec && ours) ncaaCheck.details = [{ field: 'overall record', official: ncaaRec, ours }];
  const usc = t.usc;
  const move = usc?.previous_rank != null ? usc.previous_rank - usc.rank : null;
  return (
    <header className="card overflow-hidden">
      <div className="flex flex-col gap-5 p-4 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <TeamLogo src={school?.logo_svg_url} name={p.name} size={72} />
          <div className="min-w-0">
            <h1 className="display text-3xl leading-none text-chalk-100 sm:text-4xl">{p.name}</h1>
            <p className="mt-2 text-sm text-chalk-300">{genderLabel(p.gender)} soccer, {conf ? `${conf}, ` : ''}{divisionLabel(t.season?.division)}, {season}</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
              {usc && <span className="inline-flex items-center gap-1 rounded bg-note/15 px-1.5 py-0.5 text-note tnum" title={`United Soccer Coaches ${usc.label}, ${fmt.date(usc.week_of)}`}>No. {usc.rank}{move != null && move !== 0 && <span className={`inline-flex items-center ${move > 0 ? 'text-win' : 'text-loss'}`}>{move > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />}{Math.abs(move)}</span>}<span className="text-note/70">coaches poll</span></span>}
              {t.standing && <span className="inline-flex items-center gap-1.5 tnum"><Link to={href('/standings', { division: t.season?.division, conference: t.season?.conference_id })} className="text-chalk-200 hover:text-pitch-300">{fmt.ordinal(t.standing.rank)} of {t.conferenceTable?.length ?? '–'} in the {conf}{t.standing.pod ? ` (${t.standing.pod})` : ''}, {fmt.rec(t.standing.conf_w, t.standing.conf_l, t.standing.conf_t)}</Link>{t.standing.source === 'conference' && <VerifiedMark compact state={confCheck.state} details={confCheck.details} />}</span>}
              {ncaaRec && <span className="inline-flex items-center gap-1.5 text-chalk-300 tnum" title={t.season?.official_record_at ? `NCAA.com's record as of ${fmt.agoWords(t.season.official_record_at)}` : undefined}>NCAA.com {ncaaRec}<VerifiedMark state={ncaaCheck.state} details={ncaaCheck.details} /></span>}
              {t.season && t.season.ncaa_member === false && <Badge tone="amber">Not an NCAA member</Badge>}
              {school?.athletics_host && <a className="inline-flex items-center gap-1 text-chalk-400 hover:text-pitch-300" href={`https://${school.athletics_host}`} target="_blank" rel="noreferrer">{school.athletics_host}<ExternalLink size={12} aria-hidden /><span className="sr-only">(opens the school's site)</span></a>}
            </div>
            {admin && <p className="mt-2 text-xs text-chalk-500">roster {fmt.ago(t.season?.roster_synced_at)}, schedule {fmt.ago(t.season?.schedule_synced_at)}, stats {fmt.ago(t.season?.stats_synced_at)}, box scores {fmt.ago(t.season?.boxscores_synced_at)}{t.season?.site_parse_failures ? `, ${t.season.site_parse_failures} parse failures` : ''}{school?.site_platform ? `, ${school.site_platform}` : ''}</p>}
          </div>
        </div>
        {s ? (
          <div className="flex shrink-0 flex-wrap items-end gap-x-8 gap-y-4 lg:justify-end">
            <Figure big label="Record" value={fmt.rec(s.w, s.l, s.t)} sub={`${fmt.rec(s.conf_w, s.conf_l, s.conf_t)} in conference`} />
            <div>
              <FormPips form={s.form_last5} label="Last five, oldest first" />
              <div className="mt-1 text-xs text-chalk-500">Last five{s.streak ? `, ${streakWords(s.streak)}` : ''}</div>
            </div>
          </div>
        ) : <p className="text-sm text-chalk-500">No results stored for this season yet.</p>}
      </div>
      {(last || next) && (
        <div className="grid border-t border-field-700 sm:grid-cols-2">
          {last ? <GameStrip label="Last game" g={last} id={id} href={href} /> : <div className="p-4 text-sm text-chalk-500">No games played yet.</div>}
          {next ? <GameStrip label="Next game" g={next} id={id} href={href} /> : <div className="border-t border-field-700 p-4 text-sm text-chalk-500 sm:border-l sm:border-t-0">No games scheduled.</div>}
        </div>
      )}
    </header>
  );
}

function streakWords(streak: string) {
  const m = /^([WLT])(\d+)$/i.exec(streak);
  if (!m) return streak;
  const n = Number(m[2]); const k = m[1]!.toUpperCase() as 'W' | 'L' | 'T';
  if (n === 1) return { W: 'won the last game', L: 'lost the last game', T: 'tied the last game' }[k];
  return `${n} straight ${{ W: 'wins', L: 'losses', T: 'ties' }[k]}`;
}

function GameStrip({ label, g, id, href }: { label: string; g: any; id: string; href: (p: string) => string }) {
  const side = sideOf(g, id);
  return (
    <Link to={href(`/games/${g.id}`)} className="flex items-center gap-3 p-4 transition-colors duration-150 hover:bg-field-800 sm:[&:nth-child(2)]:border-l sm:[&:nth-child(2)]:border-field-700 max-sm:[&:nth-child(2)]:border-t max-sm:[&:nth-child(2)]:border-field-700">
      <div className="w-20 shrink-0 text-xs text-chalk-500">{label}<div className="text-chalk-300">{fmt.weekday(g.game_date)}</div></div>
      <TeamLogo src={side.oppLogo} name={side.opp} size={28} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-chalk-100">{side.where} {side.opp ?? 'TBD'}</div>
        <div className="truncate text-xs text-chalk-500">{g.venue_name ? `${g.venue_name}${g.venue_city ? `, ${g.venue_city}` : ''}` : g.neutral_site ? 'Neutral site' : side.home ? 'Home' : 'Away'}{g.conference_game ? ', conference' : ''}</div>
      </div>
      {side.result ? <ResultBadge result={side.result} us={side.us} them={side.them} ot={g.overtime} pk={g.shootout} forfeit={g.forfeit} /> : <Badge>{g.status === 'scheduled' ? 'upcoming' : g.status}</Badge>}
    </Link>
  );
}
