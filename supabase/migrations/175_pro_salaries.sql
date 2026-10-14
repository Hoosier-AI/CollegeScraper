-- MLS salaries (2026-10-14): the MLS Players Association releases (base salary and guaranteed compensation), served
-- by American Soccer Analysis's public API, one row per player, club, season and release. player_id/team_id are ours
-- where pro_source_ids maps the ASA ids; the asa-salaries job fills them.
create table if not exists pro_salaries (
  source text not null,
  player_ext text not null,
  team_ext text not null default '',
  season int not null,
  release_date date not null,
  player_id int references pro_players(id) on delete set null,
  team_id int references pro_teams(id) on delete set null,
  league_id int not null,
  position text,
  base_salary numeric,
  guaranteed_comp numeric,
  updated_at timestamptz not null default now(),
  primary key (source, player_ext, season, release_date, team_ext)
);
create index if not exists pro_salaries_player_idx on pro_salaries (player_id, season desc, release_date desc);
create index if not exists pro_salaries_team_idx on pro_salaries (team_id, season, release_date);
alter table pro_salaries enable row level security;
