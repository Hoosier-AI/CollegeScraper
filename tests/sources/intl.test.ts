// International sources: martj42's results, the Fjelstul World Cup Database, openfootball's World Cups, nation
// names across them, and Plaibook Elo. Samples are lines from the real files.
import { describe, expect, it } from 'vitest';
import { applyShootouts, parseGoals, parseResults, parseShootouts, TOURNAMENT_LEAGUE } from '../../src/sources/intl/results.js';
import { parseWcdbGoals, parseWcdbMatches, parseWcdbSquads, wcdbCodes } from '../../src/sources/intl/worldcupDb.js';
import { parseWorldCupTxt } from '../../src/sources/intl/worldcupTxt.js';
import { canonicalNation, isSeniorSide, nationKey } from '../../src/sources/intl/nations.js';
import { CONFED_SHARE, confederationsFrom, drawModel, expected, goalFactor, kFactor, predict, PROVISIONAL, runElo, worldCupSides } from '../../src/sources/intl/elo.js';
import { dedupeResults, tooSmall } from '../../src/jobs/sources/intl.js';

const RESULTS = `date,home_team,away_team,home_score,away_score,tournament,city,country,neutral
1872-11-30,Scotland,England,0,0,Friendly,Glasgow,Scotland,FALSE
2022-12-18,Argentina,France,3,3,FIFA World Cup,Lusail,Qatar,TRUE
2026-10-06,Saint Martin,Bahamas,6,0,CONCACAF Nations League,Saint Croix,United States Virgin Islands,TRUE
2026-11-14,Spain,Germany,NA,NA,UEFA Nations League,Madrid,Spain,FALSE`;
const GOALS = `date,home_team,away_team,team,scorer,minute,own_goal,penalty,assist
2022-12-18,Argentina,France,Argentina,Lionel Messi,23,FALSE,TRUE,NA
2022-12-18,Argentina,France,Argentina,Ángel Di María,36,FALSE,FALSE,Alexis Mac Allister
2022-12-18,Argentina,France,France,Kylian Mbappé,80,FALSE,TRUE,NA`;
const SHOOTOUTS = `date,home_team,away_team,winner,first_shooter
2022-12-18,Argentina,France,Argentina,France`;

describe('martj42 international results', () => {
  const rows = parseResults(RESULTS);
  it('reads results with nation keys, scores, tournament and our competition', () => {
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({ source: 'intl-results', gender: 'm', level: 'senior', date: '2022-12-18', home: 'argentina', away: 'france', home_score: 3, away_score: 3, tournament: 'FIFA World Cup', league_id: 1, neutral: true, city: 'Lusail' });
    expect(rows[2]).toMatchObject({ home: 'saint-martin', away: 'bahamas', league_id: TOURNAMENT_LEAGUE['CONCACAF Nations League'] });
    // A match not played yet has no score.
    expect(rows[3]).toMatchObject({ home_score: null, away_score: null });
  });
  it('shoot-outs mark the winner; goals keep order, penalties and assists', () => {
    applyShootouts(rows, parseShootouts(SHOOTOUTS));
    expect(rows[1]!.shootout_winner).toBe('argentina');
    const g = parseGoals(GOALS);
    expect(g.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(g[0]).toMatchObject({ team: 'argentina', scorer: 'Lionel Messi', minute: 23, penalty: true, assist: null });
    expect(g[1]).toMatchObject({ assist: 'Alexis Mac Allister' });
  });
});

describe('Fjelstul World Cup Database', () => {
  const MATCHES = `key_id,tournament_id,tournament_name,match_id,match_name,stage_name,group_name,group_stage,knockout_stage,replayed,replay,match_date,match_time,stadium_id,stadium_name,city_name,country_name,home_team_id,home_team_name,home_team_code,away_team_id,away_team_name,away_team_code,score,home_team_score,away_team_score,home_team_score_margin,away_team_score_margin,extra_time,penalty_shootout,score_penalties,home_team_score_penalties,away_team_score_penalties,result,home_team_win,away_team_win,draw
964,WC-2022,2022 FIFA Men's World Cup,M-2022-64,Argentina vs France,final,not applicable,0,1,0,0,2022-12-18,18:00,S-205,Lusail Stadium,Lusail,Qatar,T-03,Argentina,ARG,T-30,France,FRA,3–3,3,3,0,0,1,1,4-2,4,2,home team win,1,0,0
1,WC-1974,1974 FIFA Men's World Cup,M-1974-01,West Germany vs Chile,group stage,Group 1,1,0,0,0,1974-06-14,16:00,S-1,Olympiastadion,Berlin,West Germany,T-31,West Germany,FRG,T-15,Chile,CHL,1–0,1,0,1,-1,0,0,0-0,0,0,home team win,1,0,0
1200,WC-2019,2019 FIFA Women's World Cup,M-2019-52,United States vs Netherlands,final,not applicable,0,1,0,0,2019-07-07,17:00,S-300,Parc Olympique Lyonnais,Lyon,France,T-83,United States,USA,T-58,Netherlands,NLD,2–0,2,0,2,-2,0,0,0-0,0,0,home team win,1,0,0`;
  const GOALS = `key_id,goal_id,tournament_id,tournament_name,match_id,match_name,match_date,stage_name,group_name,team_id,team_name,team_code,home_team,away_team,player_id,family_name,given_name,shirt_number,player_team_id,player_team_name,player_team_code,minute_label,minute_regulation,minute_stoppage,match_period,own_goal,penalty
1,G-1,WC-2022,2022 FIFA Men's World Cup,M-2022-64,Argentina vs France,2022-12-18,final,not applicable,T-03,Argentina,ARG,1,0,P-1,Messi,Lionel,10,T-03,Argentina,ARG,23',23,0,first half,0,1`;
  const SQUADS = `key_id,tournament_id,tournament_name,team_id,team_name,team_code,player_id,family_name,given_name,shirt_number,position_name,position_code
1,WC-2019,2019 FIFA Women's World Cup,T-83,United States,USA,P-2,Rapinoe,Megan,15,forward,FW`;
  const PLAYERS = `key_id,player_id,family_name,given_name,birth_date,female,goal_keeper,defender,midfielder,forward,count_tournaments,list_tournaments,player_wikipedia_link
1,P-2,Rapinoe,Megan,1985-07-05,1,0,0,0,1,3,"2011, 2015, 2019",https://en.wikipedia.org/wiki/Megan_Rapinoe`;
  const matches = parseWcdbMatches(MATCHES);
  it('reads matches, extra time and shoot-outs, men and women, historical names folded', () => {
    expect(matches[0]).toMatchObject({ source: 'worldcup-db', gender: 'm', home: 'argentina', away: 'france', home_score: 3, away_score: 3, aet: true, pen_home: 4, pen_away: 2, shootout_winner: 'argentina', league_id: 1, stage: 'final' });
    expect(matches[1]).toMatchObject({ home: 'germany', home_name: 'Germany', aet: false, pen_home: null, stage: 'group stage, Group 1' });
    expect(matches[2]).toMatchObject({ gender: 'w', home: 'united-states', league_id: 8, tournament: "FIFA Women's World Cup" });
  });
  it('places goals on their match and reads squads with birth dates and articles', () => {
    expect(parseWcdbGoals(GOALS, matches)[0]).toMatchObject({ date: '2022-12-18', home: 'argentina', team: 'argentina', scorer: 'Lionel Messi', minute: 23, penalty: true, ext_player: 'P-1' });
    expect(parseWcdbSquads(SQUADS, PLAYERS)[0]).toMatchObject({ gender: 'w', year: 2019, nation: 'united-states', player_name: 'Megan Rapinoe', shirt: 15, position: 'FW', birth_date: '1985-07-05', wiki_title: 'Megan_Rapinoe' });
    expect(wcdbCodes(MATCHES).get('germany')).toBe('FRG');
  });
});

describe('openfootball World Cup files', () => {
  it('reads the modern layout: times, extra time, shoot-outs, grounds', () => {
    const rows = parseWorldCupTxt(`= World Cup 2022       # in Qatar
▪ Round of 16
Mon Dec 5
   18:00     Japan             1-1 a.e.t (1-1, 1-0), 1-3 pen.  Croatia  @ Al Janoub Stadium, Al Wakrah
              (Daizen Maeda 43'; Ivan Perišić 55')
   22:00     Brazil            4-1 (4-0)   South Korea  @ Stadium 974, Doha
▪ Group B
Mon Nov 21
   16:00 UTC+3   England  6-2 (3-0)  Iran   @ Khalifa International Stadium, Al Rayyan`);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ date: '2022-12-05', home: 'japan', away: 'croatia', home_score: 1, away_score: 1, aet: true, pen_home: 1, pen_away: 3, shootout_winner: 'croatia', stage: 'Round of 16', city: 'Al Wakrah' });
    expect(rows[1]).toMatchObject({ home: 'brazil', away: 'south-korea', home_score: 4, away_score: 1, aet: false });
    expect(rows[2]).toMatchObject({ date: '2022-11-21', home: 'england', away: 'iran', stage: 'Group B' });
  });
  it('reads the older layout with the date on the match line, and skips matches not played', () => {
    const rows = parseWorldCupTxt(`= World Cup 1958         # in Sweden
▪ Group 1
8 June     West Germany      3-1  Argentina       @ Malmö Stadion, Malmö
July 13
  France     4-1 (3-0)  Mexico    @ Estadio Pocitos, Montevideo
                  (L. Laurent 19')
`);
    expect(rows.map((r) => `${r.date} ${r.home} ${r.home_score}-${r.away_score} ${r.away}`)).toEqual(['1958-06-08 germany 3-1 argentina', '1958-07-13 france 4-1 mexico']);
    expect(parseWorldCupTxt('= World Cup 2026\n▪ Group A\nThu Jun 11\n  13:00  Mexico  v  South Africa  @ Estadio Azteca')).toEqual([]);
  });
});

describe('nation names', () => {
  it('folds every source onto the reference spelling', () => {
    expect(nationKey('USA')).toBe('united-states');
    expect(nationKey('Korea Republic')).toBe('south-korea');
    expect(nationKey("Côte d'Ivoire")).toBe('ivory-coast');
    expect(nationKey('Bosnia & Herzegovina')).toBe('bosnia-and-herzegovina');
    expect(nationKey('São Tomé and Príncipe')).toBe('sao-tome-and-principe');
    expect(canonicalNation('USA W')).toBe('United States');
    expect(canonicalNation('West Germany')).toBe('Germany');
  });
  it('youth and B sides are not senior', () => {
    expect(isSeniorSide('Brazil U20')).toBe(false);
    expect(isSeniorSide("Guinea A'")).toBe(false);
    expect(isSeniorSide('United States')).toBe(true);
  });
});

describe('Plaibook Elo', () => {
  it('uses the World Football Elo weights', () => {
    expect(kFactor('FIFA World Cup')).toBe(60);
    expect(kFactor('UEFA Euro')).toBe(50);
    expect(kFactor('UEFA Euro qualification')).toBe(40);
    expect(kFactor('Friendly')).toBe(20);
    expect(kFactor('Gulf Cup')).toBe(30);
    // API-Football's names for the same competitions.
    expect([kFactor('World Cup - Women'), kFactor('Euro Championship'), kFactor('CONCACAF Gold Cup'), kFactor('Friendlies Women'), kFactor('World Cup - Qualification Europe')]).toEqual([60, 50, 50, 20, 40]);
    expect([goalFactor(1), goalFactor(2), goalFactor(3), goalFactor(5)]).toEqual([1, 1.5, 14 / 8, 16 / 8]);
    expect(expected(0)).toBe(0.5);
  });
  it('moves two even sides by K x G x (W - We), home edge included', () => {
    const neutral = runElo([{ date: '2020-01-01', home: 'a', away: 'b', home_score: 1, away_score: 0, tournament: 'Friendly', neutral: true }]);
    expect(neutral.ratings.get('a')).toBeCloseTo(1510);
    expect(neutral.ratings.get('b')).toBeCloseTo(1490);
    // At home, a 1-1 draw costs the home side (it was expected to win).
    const home = runElo([{ date: '2020-01-01', home: 'a', away: 'b', home_score: 1, away_score: 1, tournament: 'Friendly', neutral: false }]);
    expect(home.ratings.get('a')!).toBeLessThan(1500);
    expect(home.ratings.get('a')! + home.ratings.get('b')!).toBeCloseTo(3000);
  });
  it('the Olympics counted as a world championship until 1980', () => {
    expect(kFactor('Olympic Games', '1928-06-13')).toBe(60);
    expect(kFactor('Olympic Games', '1984-08-01')).toBe(30);
  });
  it('a new side is provisional: against an established side only its own rating moves (no inflation)', () => {
    // a and b play each other until both are established; then newcomer n loses heavily to a.
    const games = Array.from({ length: PROVISIONAL }, (_, i) => ({ date: `2000-01-${String(i + 1).padStart(2, '0')}`, home: 'a', away: 'b', home_score: 1, away_score: 1, tournament: 'Friendly', neutral: true }));
    const before = runElo(games).ratings;
    const after = runElo([...games, { date: '2000-02-01', home: 'a', away: 'n', home_score: 5, away_score: 0, tournament: 'Friendly', neutral: true }]).ratings;
    expect(after.get('a')).toBeCloseTo(before.get('a')!);
    expect(after.get('n')!).toBeLessThan(1500);
  });
  it("a side's best is its best month-end world rank, the first month it held it; today's rank is the last row", () => {
    const sides = Array.from({ length: 12 }, (_, i) => `s${i}`);
    const games: Parameters<typeof runElo>[0] = [];
    let day = 0;
    const date = () => new Date(Date.UTC(2000, 0, 1) + day++ * 86400_000).toISOString().slice(0, 10);
    // A round robin three times over (everyone established), s0 winning every game.
    for (let r = 0; r < 3; r++) for (let i = 0; i < sides.length; i++) for (let j = i + 1; j < sides.length; j++) games.push({ date: date(), home: sides[i]!, away: sides[j]!, home_score: i === 0 ? 3 : 1, away_score: i === 0 ? 0 : 1, tournament: 'FIFA World Cup qualification', neutral: true });
    const { best, history, current, ratings } = runElo(games, { ranks: { members: worldCupSides(games), minInter: 0, minPool: 10, asOf: '2001-03-01' } });
    expect(best.get('s0')?.rank).toBe(1);
    // s0 led from the first table on: its best is dated then, not later.
    expect(best.get('s0')!.month).toBe(history.get('s0')![0]!.m);
    // The best rank is the minimum of the month-end history, for every side.
    for (const [t, b] of best) expect(Math.min(...history.get(t)!.map((h) => h.r))).toBe(b.rank);
    // Today's table (asOf) is the last row of every history and orders the sides by the ratings shown.
    for (const [t, r] of current) expect(history.get(t)!.at(-1)).toEqual({ m: '2001-03', r });
    const order = [...current].sort((a, b) => a[1] - b[1]).map(([t]) => ratings.get(t)!);
    expect(order).toEqual([...order].sort((a, b) => b - a));
  });
  it('a result between confederations moves the side by K x G x (W - We), a share of it through its confederation', () => {
    const confederations = new Map([['a', 'UEFA'], ['a2', 'UEFA'], ['b', 'CAF']]);
    // Everyone established (draws among themselves), then a beats b.
    const settle = ['a', 'a2', 'b'].flatMap((t, i) => Array.from({ length: PROVISIONAL }, (_, j) => ({ date: `1999-0${i + 1}-${String(j + 1).padStart(2, '0')}`, home: t, away: `x${i}`, home_score: 0, away_score: 0, tournament: 'Friendly', neutral: true })));
    const games = [...settle, { date: '2000-01-01', home: 'a', away: 'b', home_score: 1, away_score: 0, tournament: 'Friendly', neutral: true }];
    const run = runElo(games, { confederations });
    const step = run.steps.at(-2)!;
    expect(step.delta).toBeCloseTo(20 * (1 - step.expected));
    expect(step.rating - step.delta).toBeCloseTo(1500);
    expect(run.ratings.get('a')).toBeCloseTo(1500 + step.delta);
    // a2 never played b, and gains the confederation's share.
    expect(run.ratings.get('a2')).toBeCloseTo(1500 + CONFED_SHARE * step.delta);
    expect(run.levels.get('UEFA')).toBeCloseTo(-run.levels.get('CAF')!);
  });
  it('each move carries its reasons: score, expected result, weight, goal factor, venue', () => {
    const { steps } = runElo([{ date: '2021-06-06', home: 'united-states', away: 'mexico', home_score: 3, away_score: 2, tournament: 'CONCACAF Nations League', neutral: true }]);
    const [us, mx] = steps;
    expect(us).toMatchObject({ nation: 'united-states', opponent: 'mexico', gf: 3, ga: 2, oppRating: 1500, expected: 0.5, k: 40, goalFactor: 1, venue: 'neutral' });
    expect(us!.delta).toBeCloseTo(40 * 1 * (1 - 0.5));
    expect(mx).toMatchObject({ gf: 2, ga: 3, expected: 0.5, venue: 'neutral' });
    const home = runElo([{ date: '2021-06-06', home: 'a', away: 'b', home_score: 0, away_score: 0, tournament: 'Friendly', neutral: false }]).steps;
    expect(home[0]).toMatchObject({ venue: 'home' });
    expect(home[0]!.expected).toBeCloseTo(expected(100));
    expect(home[1]).toMatchObject({ venue: 'away' });
  });
  it('win, draw, win: the draw rate comes from how often even matches are drawn, and the chances add up', () => {
    const games = Array.from({ length: 40 }, (_, i) => ({ date: `2000-01-${String((i % 28) + 1).padStart(2, '0')}`, home: `h${i}`, away: `a${i}`, home_score: i % 4 === 0 ? 1 : 2, away_score: 1, tournament: 'Friendly', neutral: true }));
    const model = drawModel(runElo(games).steps);
    expect(model[0]).toBeCloseTo(0.25); // ten of forty even matches drawn
    for (const we of [0.05, 0.3, 0.5, 0.8, 0.97]) { const p = predict(we, model); expect(p.win + p.draw + p.loss).toBeCloseTo(1); expect(p.win - p.loss).toBeCloseTo(we - (1 - we), 1); }
    expect(predict(0.9, model).win).toBeGreaterThan(predict(0.6, model).win);
  });
  it('confederations come from the continental competitions a side plays', () => {
    const c = confederationsFrom([{ home: 'mexico', away: 'united-states', tournament: 'Gold Cup' }, { home: 'spain', away: 'italy', tournament: 'UEFA Euro qualification' }, { home: 'mexico', away: 'spain', tournament: 'Friendly' }]);
    expect([c.get('mexico'), c.get('united-states'), c.get('spain')]).toEqual(['CONCACAF', 'CONCACAF', 'UEFA']);
  });
  it('one copy of each match: the World Cup database over martj42 over openfootball, either way round', () => {
    const rows = dedupeResults([
      { source: 'openfootball-wc', date: '2022-12-18', home: 'france', away: 'argentina' },
      { source: 'intl-results', date: '2022-12-18', home: 'argentina', away: 'france' },
      { source: 'worldcup-db', date: '2022-12-18', home: 'argentina', away: 'france' },
      { source: 'intl-results', date: '2022-12-14', home: 'argentina', away: 'croatia' },
    ]);
    expect(rows.map((r) => r.source)).toEqual(['intl-results', 'worldcup-db']);
  });
});

describe('the shrink guard', () => {
  it('accepts a smaller API-Football download when the missing matches now come from another source', () => {
    // 2026-10-19: 3538 stored, 415 of them now in martj42's results, 3123 fresh.
    expect(tooSmall(3123, 3538, 415)).toBe(false);
  });
  it('still refuses a download that really lost rows', () => {
    expect(tooSmall(3123, 3538)).toBe(true);
    expect(tooSmall(2000, 3538, 415)).toBe(true);
  });
  it('accepts anything when nothing is stored', () => {
    expect(tooSmall(0, 0)).toBe(false);
  });
});
