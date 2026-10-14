-- Plaibook Elo for college programs and pro clubs (2026-10-14), worked out nightly by the college-elo and pro-elo
-- jobs with the same engine as International (src/sources/intl/elo.ts). One row per team: today's rating, its rank and
-- the change over 30 days.

create table if not exists college_elo (
  program_id uuid primary key references college_programs(id) on delete cascade,
  gender text not null,
  season int not null,
  division text,
  conference_id uuid,
  rating numeric not null,
  games int not null,
  rank int,            -- within gender and division, NCAA members with 3+ games this season
  rank_all int,        -- within gender, every division
  change_30d numeric,
  last_match date,
  updated_at timestamptz not null default now()
);
create index if not exists college_elo_rank_idx on college_elo (gender, division, rank);
create index if not exists college_elo_all_idx on college_elo (gender, rank_all);

create table if not exists pro_elo (
  team_id bigint primary key,
  gender text not null,
  country text,
  rating numeric not null,
  games int not null,
  rank int,            -- within gender, clubs with 10+ matches and one in the last year
  change_30d numeric,
  last_match date,
  updated_at timestamptz not null default now()
);
create index if not exists pro_elo_rank_idx on pro_elo (gender, rank);
create index if not exists pro_elo_country_idx on pro_elo (gender, country, rating desc);

-- Foreign keys for the API's embeds (a program's conference, a club's name and crest).
alter table college_elo add constraint college_elo_conference_fk foreign key (conference_id) references college_conferences(id) on delete set null;
alter table pro_elo add constraint pro_elo_team_fk foreign key (team_id) references pro_teams(id) on delete cascade;

alter table college_elo enable row level security;
alter table pro_elo enable row level security;

-- Club results for the pro-elo job, a batch at a time as compact arrays: [id, date, home, away, home goals, away
-- goals, league id]. Keyset paging on id (the job sorts by date itself).
create or replace function pro_elo_fixtures(p_since date, p_after bigint, p_limit int)
returns json language sql stable as $$
  select coalesce(json_agg(json_build_array(f.id, to_char(f.kickoff at time zone 'UTC', 'YYYY-MM-DD'), f.home_team_id, f.away_team_id, f.home_goals, f.away_goals, f.league_id) order by f.id), '[]'::json)
  from (
    select f.id, f.kickoff, f.home_team_id, f.away_team_id, f.home_goals, f.away_goals, f.league_id
    from pro_fixtures f join pro_leagues l on l.id = f.league_id
    where f.status = 'final' and l.scope = 'club' and f.home_goals is not null and f.away_goals is not null
      and f.kickoff >= p_since and f.id > p_after
    order by f.id limit p_limit
  ) f;
$$;
