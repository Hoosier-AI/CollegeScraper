-- Live RPI (2026-10-14): every program's RPI from the season's results, recomputed by the college-rpi job within
-- minutes of each final, with NCAA.com's official D1 rank beside it and one row a day of history for the trend.
create table if not exists college_rpi (
  program_id uuid primary key references college_programs(id) on delete cascade,
  gender text not null,
  season int not null,
  division text not null,
  conference_id uuid references college_conferences(id) on delete set null,
  w int not null, l int not null, t int not null,
  wp numeric not null, owp numeric not null, oowp numeric not null, rpi numeric not null,
  rank int,                 -- within gender and division (NCAA members)
  rank_yesterday int,
  official_rank int,        -- NCAA.com's published D1 order (no values are published)
  official_prev int,
  official_as_of text,
  updated_at timestamptz not null default now()
);
create index if not exists college_rpi_rank_idx on college_rpi (gender, division, rank);

create table if not exists college_rpi_history (
  program_id uuid not null references college_programs(id) on delete cascade,
  season int not null,
  day date not null,
  rpi numeric not null,
  rank int,
  primary key (program_id, season, day)
);

alter table college_rpi enable row level security;
alter table college_rpi_history enable row level security;
